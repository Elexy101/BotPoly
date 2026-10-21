// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BOTPoly is Ownable, ERC1155, ReentrancyGuard {
    IERC20 public constant USDT =
        IERC20(0x75edC9335175Fc0552D51D48439F229c10420fe3);

    uint256 public constant INITIAL_TOKENS = 100;
    uint256 public constant TOTAL_SUPPLY_CAP = 12_000_000;
    uint256 public constant BOARD_SIZE = 12;
    uint256 public constant HPOLY_TOKEN_ID = 0;

    // --- Tuning knobs ---
    uint256 public constant MAX_POINTS = 100;        // per-player claim cap
    uint256 public constant MAX_DEBT = 300;          // debt ceiling (2 big losses)
    uint256 public constant LOSS_MULTIPLIER_NUM = 3; // LOSS scaled to 3/4 (75%)
    uint256 public constant LOSS_MULTIPLIER_DEN = 4;

    uint256 public constant REROLL_COST = 1 * 10**6;        // 1 USDT
    uint256 public constant DOUBLE_REWARD_COST = 2 * 10**6; // 2 USDT

    enum TileType { NEUTRAL, PROFIT, LOSS }

    struct Tile {
        TileType tileType;
        int32 value;
        string name;
    }

    struct Player {
        uint8 position;
        bool hasStarted;
        uint256 balance;
        uint256 pointsEarned;
        uint256 debt;       // NEW
    }

    uint256 public tokenCap;
    uint256 public totalHPOLYSupply;
    address public treasury;

    mapping(address => Player) public players;
    mapping(address => bool) public hasMintedInitial;
    mapping(address => uint256) public nextRequiredHPOLY;
    mapping(address => uint256) public rerollCredits;
    mapping(address => uint256) public doubleRewardCredits;

    Tile[BOARD_SIZE] private board;

    event GameStarted(address indexed player);
    event DiceRolled(address indexed player, uint256 roll, uint256 newPosition);
    event ProfitLanded(address indexed player, uint256 reward);
    event LossLanded(address indexed player, uint256 penalty, uint256 debtAdded);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);
    event PointEarned(address indexed player, uint256 points);
    event BoostPurchased(address indexed player, string boostType, uint256 quantity);

    constructor() ERC1155("") Ownable(msg.sender) {
        treasury = msg.sender;
        tokenCap = 200;
        _initializeBoard();
    }

    // --- Core game ---

    function mintTokens() external {
        require(!hasMintedInitial[msg.sender], "Already minted");
        require(
            totalHPOLYSupply + INITIAL_TOKENS <= TOTAL_SUPPLY_CAP,
            "Supply cap exceeded"
        );
        hasMintedInitial[msg.sender] = true;
        totalHPOLYSupply += INITIAL_TOKENS;
        _mint(msg.sender, HPOLY_TOKEN_ID, INITIAL_TOKENS, "");
        emit TokensMinted(msg.sender, INITIAL_TOKENS);
    }

    function startGame() external {
        require(!players[msg.sender].hasStarted, "Already playing");
        require(
            balanceOf(msg.sender, HPOLY_TOKEN_ID) >= INITIAL_TOKENS,
            "Insufficient HPOLY"
        );

        uint256 existingPoints = players[msg.sender].pointsEarned;
        uint256 existingDebt   = players[msg.sender].debt;

        players[msg.sender] = Player({
            position: 0,
            hasStarted: true,
            balance: INITIAL_TOKENS,
            pointsEarned: existingPoints,
            debt: existingDebt
        });
        nextRequiredHPOLY[msg.sender] = tokenCap;

        emit GameStarted(msg.sender);
    }

    function rollDice(bool useDoubleReward) external nonReentrant {
        Player storage player = players[msg.sender];
        require(player.hasStarted, "Start game first");

        bool doubleReward = false;
        if (useDoubleReward) {
            require(doubleRewardCredits[msg.sender] > 0, "No double reward credit");
            doubleRewardCredits[msg.sender]--;
            doubleReward = true;
        }

        uint256 roll = (_random() % 6) + 1;
        player.position = uint8((player.position + roll) % BOARD_SIZE);

        emit DiceRolled(msg.sender, roll, player.position);
        _handleLanding(msg.sender, player.position, doubleReward);
    }

    function claimPoint() external {
        Player storage player = players[msg.sender];
        require(player.hasStarted, "Start game first");
        require(player.pointsEarned < MAX_POINTS, "Point cap reached");

        uint256 required = nextRequiredHPOLY[msg.sender];
        require(
            balanceOf(msg.sender, HPOLY_TOKEN_ID) >= required,
            "Insufficient HPOLY"
        );

        totalHPOLYSupply -= required;
        _burn(msg.sender, HPOLY_TOKEN_ID, required);
        emit TokensBurned(msg.sender, required);

        player.pointsEarned++;
        player.balance = balanceOf(msg.sender, HPOLY_TOKEN_ID);
        nextRequiredHPOLY[msg.sender] = required + 100;

        // Softener C — claiming a point clears debt
        player.debt = 0;

        emit PointEarned(msg.sender, player.pointsEarned);
    }

    function endGame() external {
        require(players[msg.sender].hasStarted, "Not playing");
        players[msg.sender].hasStarted = false;
    }

    // --- USDT boosts ---

    function buyReroll(uint256 quantity) external nonReentrant {
        require(quantity > 0 && quantity <= 5, "Invalid quantity");
        uint256 cost = REROLL_COST * quantity;
        require(USDT.transferFrom(msg.sender, treasury, cost), "USDT transfer failed");
        rerollCredits[msg.sender] += quantity;
        emit BoostPurchased(msg.sender, "REROLL", quantity);
    }

    function buyDoubleReward(uint256 quantity) external nonReentrant {
        require(quantity > 0 && quantity <= 5, "Invalid quantity");
        uint256 cost = DOUBLE_REWARD_COST * quantity;
        require(USDT.transferFrom(msg.sender, treasury, cost), "USDT transfer failed");
        doubleRewardCredits[msg.sender] += quantity;
        emit BoostPurchased(msg.sender, "DOUBLE", quantity);
    }

    // --- Admin ---

    function setTokenCap(uint256 _tokenCap) external onlyOwner {
        require(_tokenCap > INITIAL_TOKENS, "Cap too low");
        tokenCap = _tokenCap;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid address");
        treasury = _treasury;
    }

    // --- Views ---

    function getTile(uint256 position) external view returns (string memory, TileType, int256) {
        require(position < BOARD_SIZE, "Invalid tile");
        Tile memory t = board[position];
        return (t.name, t.tileType, int256(t.value));
    }

    function getPlayerState(address playerAddr)
        external view
        returns (uint256 position, uint256 balance, bool hasStarted, uint256 pointsEarned, uint256 debt)
    {
        Player memory p = players[playerAddr];
        return (p.position, p.balance, p.hasStarted, p.pointsEarned, p.debt);
    }

    // --- Internal ---

    function _handleLanding(address playerAddr, uint8 position, bool doubleReward) internal {
        Player storage player = players[playerAddr];
        Tile memory tile = board[position];

        if (tile.tileType == TileType.PROFIT) {
            uint256 reward = uint256(uint32(uint256(int256(tile.value))));
            if (doubleReward) reward *= 2;

            // Pay debt first
            if (player.debt > 0) {
                uint256 pay = reward >= player.debt ? player.debt : reward;
                player.debt -= pay;
                reward -= pay;
            }

            if (reward > 0 && totalHPOLYSupply + reward <= TOTAL_SUPPLY_CAP) {
                totalHPOLYSupply += reward;
                _mint(playerAddr, HPOLY_TOKEN_ID, reward, "");
                player.balance += reward;
                emit ProfitLanded(playerAddr, reward);
            }
        } else if (tile.tileType == TileType.LOSS) {
            uint256 basePenalty = uint256(uint32(uint256(int256(-tile.value))));
            // Soften LOSS to 75% — game is intermediate, not punishing
            uint256 penalty = (basePenalty * LOSS_MULTIPLIER_NUM) / LOSS_MULTIPLIER_DEN;

            uint256 currentBalance = balanceOf(playerAddr, HPOLY_TOKEN_ID);
            uint256 burnAmount = currentBalance >= penalty ? penalty : currentBalance;
            uint256 unpaid = penalty - burnAmount;

            if (burnAmount > 0) {
                totalHPOLYSupply -= burnAmount;
                _burn(playerAddr, HPOLY_TOKEN_ID, burnAmount);
                player.balance -= burnAmount;
            }

            if (unpaid > 0) {
                // Cap debt so bad streaks never spiral
                uint256 newDebt = player.debt + unpaid;
                if (newDebt > MAX_DEBT) newDebt = MAX_DEBT;
                player.debt = newDebt;
            }

            emit LossLanded(playerAddr, burnAmount, player.debt);
        }
    }

    function _random() internal view returns (uint256) {
        return uint256(
            keccak256(abi.encodePacked(
                block.prevrandao, block.timestamp, msg.sender, block.number
            ))
        );
    }

    function _initializeBoard() private {
        board[0]  = Tile(TileType.NEUTRAL, 0,    "GO");
        board[1]  = Tile(TileType.PROFIT,  100,  "Addis Ababa");
        board[2]  = Tile(TileType.LOSS,   -50,   "Community C");
        board[3]  = Tile(TileType.PROFIT,  80,   "Freelance");
        board[4]  = Tile(TileType.LOSS,   -100,  "Car Repair");
        board[5]  = Tile(TileType.PROFIT,  120,  "Lagos");
        board[6]  = Tile(TileType.NEUTRAL, 0,    "Jail");
        board[7]  = Tile(TileType.PROFIT,  140,  "Nairobi");
        board[8]  = Tile(TileType.LOSS,   -80,   "Chance");
        board[9]  = Tile(TileType.PROFIT,  160,  "Cairo");
        board[10] = Tile(TileType.NEUTRAL, 0,    "Free Park");
        board[11] = Tile(TileType.LOSS,   -120,  "Go To Jail");
    }
}