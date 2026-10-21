const config = {
    initialTokens: '600',
    refreshInterval: 5000,
    contractAddress: '0x5595D7f430511cFe12640C14B525151f65d470Dc', // BOT Chain Testnet
    usdtAddress: '0x75edC9335175Fc0552D51D48439F229c10420fe3',      // BOT Chain Test USDT
    hpolyTokenId: 0,
    boardSize: 12
};

// === BOT CHAIN TESTNET (Bohr) ===
const BOT_TESTNET = {
    chainId: "0x3C8", // 968
    chainName: "BOT Chain Testnet (Bohr)",
    nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
    rpcUrls: ["https://rpc.bohr.life"],
    blockExplorerUrls: ["https://scan.bohr.life"]
};

// === GAS OVERRIDES ===
// BOT Chain Bohr testnet enforces a minimum priority fee of 20 Gwei.
const GAS_FEE = {
    maxPriorityFeePerGas: '30000000000', // 30 Gwei
    maxFeePerGas: '60000000000'          // 60 Gwei
};

let web3, contract, usdtContract;
let accounts = [];
let currentPlayerPosition = 0;
let gameStarted = false;
let tileData = [];
let refreshInterval;
let autoRefreshEnabled = true;

const tilePositions = [];
for (let i = 0; i < config.boardSize; i++) {
    let left, top;
    if (i < 3) { left = 85 - (i * 25); top = 85; }
    else if (i < 6) { left = 10; top = 85 - ((i - 3) * 25); }
    else if (i < 9) { left = 10 + ((i - 6) * 25); top = 10; }
    else { left = 85; top = 10 + ((i - 9) * 25); }
    tilePositions.push({ left: `${left}%`, top: `${top}%` });
}

// --- Minimal, correct ABIs for the new BOTPoly contract ---
const CONTRACT_ABI = [
    // actions
    { "inputs": [], "name": "mintTokens", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "startGame", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "bool", "name": "useDoubleReward", "type": "bool" }], "name": "rollDice", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "claimPoint", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [], "name": "endGame", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "uint256", "name": "quantity", "type": "uint256" }], "name": "buyReroll", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "uint256", "name": "quantity", "type": "uint256" }], "name": "buyDoubleReward", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
    // views
    { "inputs": [], "name": "HPOLY_TOKEN_ID", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "INITIAL_TOKENS", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "tokenCap", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "totalHPOLYSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "TOTAL_SUPPLY_CAP", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "MAX_POINTS", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "MAX_DEBT", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "REROLL_COST", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "DOUBLE_REWARD_COST", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "USDT", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }, { "internalType": "uint256", "name": "id", "type": "uint256" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "hasMintedInitial", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "nextRequiredHPOLY", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "rerollCredits", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "", "type": "address" }], "name": "doubleRewardCredits", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    {
        "inputs": [{ "internalType": "address", "name": "playerAddr", "type": "address" }],
        "name": "getPlayerState",
        "outputs": [
            { "internalType": "uint256", "name": "position",     "type": "uint256" },
            { "internalType": "uint256", "name": "balance",      "type": "uint256" },
            { "internalType": "bool",    "name": "hasStarted",   "type": "bool"    },
            { "internalType": "uint256", "name": "pointsEarned", "type": "uint256" },
            { "internalType": "uint256", "name": "debt",         "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    { "inputs": [{ "internalType": "uint256", "name": "position", "type": "uint256" }], "name": "getTile", "outputs": [ { "internalType": "string", "name": "", "type": "string" }, { "internalType": "uint8", "name": "", "type": "uint8" }, { "internalType": "int256", "name": "", "type": "int256" } ], "stateMutability": "view", "type": "function" },
    // events
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }], "name": "GameStarted", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "roll", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "newPosition", "type": "uint256" }], "name": "DiceRolled", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "reward", "type": "uint256" }], "name": "ProfitLanded", "type": "event" },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true,  "internalType": "address", "name": "player",    "type": "address" },
            { "indexed": false, "internalType": "uint256", "name": "penalty",   "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "debtAdded", "type": "uint256" }
        ],
        "name": "LossLanded",
        "type": "event"
    },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "to", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "TokensMinted", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "from", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "TokensBurned", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "points", "type": "uint256" }], "name": "PointEarned", "type": "event" },
    { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "player", "type": "address" }, { "indexed": false, "internalType": "string", "name": "boostType", "type": "string" }, { "indexed": false, "internalType": "uint256", "name": "quantity", "type": "uint256" }], "name": "BoostPurchased", "type": "event" }
];

const USDT_ABI = [
    { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
    { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
];

document.addEventListener('DOMContentLoaded', async () => {
    initializeBoard();
    setupEventListeners();
    await tryAutoConnect();
});

async function tryAutoConnect() {
    if (window.ethereum) {
        await initializeWeb3();
    } else {
        addLogEntry("MetaMask not detected. Please install MetaMask.", 'loss');
    }
}

function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
        if (accounts.length > 0 && contract) {
            await updateGameState();
            await updateUI();
        }
    }, config.refreshInterval);
}

function stopAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
}

async function initializeWeb3() {
    if (!window.ethereum) {
        alert("Please install MetaMask or another Web3 wallet!");
        addLogEntry("No Web3 wallet detected. Please install MetaMask.", 'loss');
        return;
    }
    try {
        const connectBtn = document.getElementById('connectWallet');
        connectBtn.disabled = true;
        connectBtn.textContent = "Connecting...";
        connectBtn.classList.add('loading');

        accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }).catch(err => {
            if (err.code === 4001) throw new Error("User rejected connection request.");
            throw err;
        });

        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId !== BOT_TESTNET.chainId) {
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: BOT_TESTNET.chainId }],
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    try {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [BOT_TESTNET],
                        });
                    } catch (addError) {
                        addLogEntry(`Failed to add BOT Chain Testnet: ${addError.message}`, 'loss');
                        resetConnectButton();
                        return;
                    }
                } else {
                    addLogEntry(`Failed to switch to BOT Chain Testnet: ${switchError.message}`, 'loss');
                    resetConnectButton();
                    return;
                }
            }
        }

        web3 = new Web3(window.ethereum);
        contract = new web3.eth.Contract(CONTRACT_ABI, config.contractAddress);
        usdtContract = new web3.eth.Contract(USDT_ABI, config.usdtAddress);

        // Sanity check with a function that exists in the new ABI
        try {
            await contract.methods.HPOLY_TOKEN_ID().call();
        } catch (error) {
            addLogEntry(`Contract error at ${config.contractAddress}: ${error.message}`, 'loss');
            resetConnectButton();
            return;
        }

        await loadTileData();
        await updateUI();
        await updateGameState();
        startAutoRefresh();

        window.ethereum.on('accountsChanged', (newAccounts) => {
            accounts = newAccounts;
            updateUI();
            updateGameState();
            addLogEntry("Wallet account changed", 'neutral');
        });
        window.ethereum.on('chainChanged', () => window.location.reload());

        setupContractEventListeners();

        connectBtn.textContent = "CONNECTED";
        connectBtn.classList.remove('loading');
        connectBtn.style.backgroundColor = "#4CAF50";
        connectBtn.disabled = true;
        addLogEntry("Wallet connected successfully", 'neutral');
    } catch (error) {
        console.error("Web3 Error:", error);
        addLogEntry(`Error connecting wallet: ${error.message}`, 'loss');
        resetConnectButton();
    }
}

async function loadTileData() {
    tileData = [];
    for (let i = 0; i < config.boardSize; i++) {
        try {
            const tile = await contract.methods.getTile(i).call();
            tileData.push({ name: tile[0], type: tile[1], value: tile[2] });
            updateTileVisual(i, tile[0], tile[1]);
        } catch (error) {
            console.error(`Error loading tile ${i}:`, error);
            addLogEntry(`Error loading tile ${i}: ${error.message}`, 'loss');
        }
    }
}

function updateTileVisual(index, name, type) {
    const tile = document.getElementById(`tile-${index}`);
    if (!tile) return;
    tile.textContent = name || `Tile ${index}`;
    tile.className = 'tile';
    const t = String(type);
    if (t === '1') { tile.classList.add('tile-profit'); tile.innerHTML += ' 💰'; }
    else if (t === '2') { tile.classList.add('tile-loss'); tile.innerHTML += ' ⚠️'; }
    else { tile.innerHTML += ' 🟦'; }
}

function setupEventListeners() {
    document.getElementById('connectWallet').addEventListener('click', initializeWeb3);
    document.getElementById('mintTokensBtn').addEventListener('click', mintTokens);
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    document.getElementById('rollDiceBtn').addEventListener('click', rollDice);
    document.getElementById('claimPointBtn').addEventListener('click', claimPoint);
    document.getElementById('endGameBtn').addEventListener('click', endGame);
    document.getElementById('autoRefreshToggle').addEventListener('change', (e) => {
        autoRefreshEnabled = e.target.checked;
        if (autoRefreshEnabled) startAutoRefresh(); else stopAutoRefresh();
    });
    document.getElementById('helpBtn').addEventListener('click', () => {
        document.getElementById('helpModal').style.display = 'block';
    });
    document.getElementsByClassName('close')[0].addEventListener('click', () => {
        document.getElementById('helpModal').style.display = 'none';
    });
    window.addEventListener('click', (event) => {
        if (event.target === document.getElementById('helpModal')) {
            document.getElementById('helpModal').style.display = 'none';
        }
    });

    document.querySelectorAll('.shop-buy').forEach(btn => {
        btn.addEventListener('click', () => buyBoost(btn.dataset.item));
    });
}

function setupContractEventListeners() {
    contract.events.GameStarted({}).on('data', event => {
        if (event.returnValues.player.toLowerCase() === accounts[0].toLowerCase()) {
            addLogEntry("Game started!", 'neutral');
            gameStarted = true;
            updateGameState();
            loadTileData();
        }
    }).on('error', () => addLogEntry("Error listening to game events", 'loss'));

    contract.events.DiceRolled({}).on('data', event => {
        if (event.returnValues.player.toLowerCase() === accounts[0].toLowerCase()) {
            addLogEntry(`Rolled ${event.returnValues.roll}, moved to position ${event.returnValues.newPosition}`, 'neutral');
            updateGameState();
        }
    });
    contract.events.ProfitLanded({}).on('data', event => {
        if (event.returnValues.player.toLowerCase() === accounts[0].toLowerCase()) {
            addLogEntry(`+${event.returnValues.reward} HPOLY from landing!`, 'profit');
            updateGameState();
        }
    });
    contract.events.LossLanded({}).on('data', event => {
        if (event.returnValues.player.toLowerCase() === accounts[0].toLowerCase()) {
            const penalty = event.returnValues.penalty;
            const debtAdded = event.returnValues.debtAdded;
            addLogEntry(`-${penalty} HPOLY burned | debt now: ${debtAdded}`, 'loss');
            updateGameState();
        }
    });
    contract.events.TokensMinted({}).on('data', event => {
        if (event.returnValues.to.toLowerCase() === accounts[0].toLowerCase()) {
            addLogEntry(`Minted ${event.returnValues.amount} HPOLY`, 'profit');
            updateGameState();
        }
    });
    contract.events.TokensBurned({}).on('data', event => {
        if (event.returnValues.from.toLowerCase() === accounts[0].toLowerCase()) {
            addLogEntry(`Burned ${event.returnValues.amount} HPOLY`, 'loss');
            updateGameState();
        }
    });
    contract.events.PointEarned({}).on('data', event => {
        if (event.returnValues.player.toLowerCase() === accounts[0].toLowerCase()) {
            addLogEntry(`Earned point! Total: ${event.returnValues.points} (debt cleared)`, 'profit');
            updateUI();
        }
    });
    contract.events.BoostPurchased({}).on('data', event => {
        if (event.returnValues.player.toLowerCase() === accounts[0].toLowerCase()) {
            addLogEntry(`Purchased ${event.returnValues.quantity} × ${event.returnValues.boostType}`, 'profit');
            updateUI();
        }
    });
}

function resetConnectButton() {
    const connectBtn = document.getElementById('connectWallet');
    connectBtn.disabled = false;
    connectBtn.textContent = "CONNECT WALLET";
    connectBtn.classList.remove('loading');
    connectBtn.style.backgroundColor = "";
}

function initializeBoard() {
    const board = document.getElementById('board');
    for (let i = 0; i < config.boardSize; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.id = `tile-${i}`;
        tile.style.left = tilePositions[i].left;
        tile.style.top = tilePositions[i].top;
        tile.textContent = `Loading...`;
        tile.addEventListener('click', () => showTileDetails(i));
        board.appendChild(tile);
    }
    const token = document.createElement('div');
    token.className = 'player-token';
    token.id = 'player-token';
    token.style.display = 'none';
    board.appendChild(token);
}

async function mintTokens() {
    try {
        document.getElementById('mintTokensBtn').disabled = true;
        document.getElementById('mintTokensBtn').textContent = "Minting...";
        document.getElementById('mintTokensBtn').classList.add('loading');
        await contract.methods.mintTokens().send({ from: accounts[0], gas: 500000, ...GAS_FEE });
        document.getElementById('mintTokensBtn').textContent = "💰 MINT HPOLY";
        document.getElementById('mintTokensBtn').classList.remove('loading');
    } catch (error) {
        console.error("Mint Tokens Error:", error);
        addLogEntry(`Error minting tokens: ${error.message}`, 'loss');
        document.getElementById('mintTokensBtn').disabled = false;
        document.getElementById('mintTokensBtn').textContent = "💰 MINT HPOLY";
        document.getElementById('mintTokensBtn').classList.remove('loading');
    }
}

async function startGame() {
    try {
        document.getElementById('startGameBtn').disabled = true;
        document.getElementById('startGameBtn').textContent = "Starting...";
        document.getElementById('startGameBtn').classList.add('loading');
        await contract.methods.startGame().send({ from: accounts[0], gas: 500000, ...GAS_FEE });
        document.getElementById('startGameBtn').textContent = "Game Started";
        document.getElementById('startGameBtn').style.backgroundColor = "#4CAF50";
        document.getElementById('startGameBtn').classList.remove('loading');
        document.getElementById('player-token').style.display = 'block';
    } catch (error) {
        console.error("Start Game Error:", error);
        addLogEntry(`Error starting game: ${error.message}`, 'loss');
        document.getElementById('startGameBtn').disabled = false;
        document.getElementById('startGameBtn').textContent = "🚀 START GAME";
        document.getElementById('startGameBtn').classList.remove('loading');
    }
}

async function rollDice() {
    try {
        const rollBtn = document.getElementById('rollDiceBtn');
        rollBtn.disabled = true;
        rollBtn.classList.add('dice-animation');
        const diceResult = document.getElementById('diceResult');
        diceResult.style.display = 'block';
        diceResult.textContent = '🎲 Rolling...';
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 300));
            diceResult.textContent = `🎲 Rolling... ${i + 1}`;
        }

        let useDouble = false;
        try {
            const credits = await contract.methods.doubleRewardCredits(accounts[0]).call();
            if (Number(credits) > 0) {
                useDouble = confirm(`You have ${credits} Double Reward credit(s). Use one this roll?`);
            }
        } catch (_) { /* ignore */ }

        await contract.methods.rollDice(useDouble).send({ from: accounts[0], gas: 500000, ...GAS_FEE });

        setTimeout(() => {
            diceResult.style.display = 'none';
            rollBtn.classList.remove('dice-animation');
        }, 2000);
    } catch (error) {
        console.error("Roll Dice Error:", error);
        addLogEntry(`Error rolling dice: ${error.message}`, 'loss');
        document.getElementById('rollDiceBtn').disabled = false;
        document.getElementById('rollDiceBtn').classList.remove('dice-animation');
        document.getElementById('diceResult').style.display = 'none';
    }
}

async function claimPoint() {
    try {
        document.getElementById('claimPointBtn').disabled = true;
        document.getElementById('claimPointBtn').textContent = "Claiming...";
        document.getElementById('claimPointBtn').classList.add('loading');
        await contract.methods.claimPoint().send({ from: accounts[0], gas: 500000, ...GAS_FEE });
        document.getElementById('claimPointBtn').textContent = "🔥 CLAIM POINT";
        document.getElementById('claimPointBtn').classList.remove('loading');
    } catch (error) {
        console.error("Claim Point Error:", error);
        addLogEntry(`Error claiming point: ${error.message}`, 'loss');
        document.getElementById('claimPointBtn').disabled = false;
        document.getElementById('claimPointBtn').textContent = "🔥 CLAIM POINT";
        document.getElementById('claimPointBtn').classList.remove('loading');
    }
}

async function endGame() {
    try {
        document.getElementById('endGameBtn').disabled = true;
        document.getElementById('endGameBtn').textContent = "Ending...";
        document.getElementById('endGameBtn').classList.add('loading');
        await contract.methods.endGame().send({ from: accounts[0], gas: 500000, ...GAS_FEE });
        document.getElementById('endGameBtn').textContent = "🏁 END GAME";
        document.getElementById('endGameBtn').classList.remove('loading');
        document.getElementById('player-token').style.display = 'none';
    } catch (error) {
        console.error("End Game Error:", error);
        addLogEntry(`Error ending game: ${error.message}`, 'loss');
        document.getElementById('endGameBtn').disabled = false;
        document.getElementById('endGameBtn').textContent = "🏁 END GAME";
        document.getElementById('endGameBtn').classList.remove('loading');
    }
}

async function buyBoost(item) {
    try {
        const cost = item === 'reroll' ? 1_000_000 : 2_000_000;

        const allowance = await usdtContract.methods
            .allowance(accounts[0], config.contractAddress)
            .call();
        if (Number(allowance) < cost) {
            addLogEntry("Approving USDT...", 'neutral');
            await usdtContract.methods
                .approve(config.contractAddress, '1000000000')
                .send({ from: accounts[0], gas: 100000, ...GAS_FEE });
        }

        const method = item === 'reroll' ? 'buyReroll' : 'buyDoubleReward';
        await contract.methods[method](1).send({ from: accounts[0], gas: 500000, ...GAS_FEE });
    } catch (error) {
        console.error("Buy Boost Error:", error);
        addLogEntry(`Error buying boost: ${error.message}`, 'loss');
    }
}

async function updateUI() {
    if (accounts.length === 0) return;

    document.getElementById('connectWallet').style.display = 'none';
    document.getElementById('walletInfo').style.display = 'block';
    const shortAddress = `${accounts[0].substring(0, 6)}...${accounts[0].substring(38)}`;
    document.getElementById('walletAddress').textContent = shortAddress;

    try {
        const balance = await web3.eth.getBalance(accounts[0]);
        const botEl = document.getElementById('hbarBalance') || document.getElementById('botBalance');
        if (botEl) botEl.textContent = parseFloat(web3.utils.fromWei(balance, 'ether')).toFixed(4);

        const usdtBal = await usdtContract.methods.balanceOf(accounts[0]).call();
        const usdtEl = document.getElementById('usdtBalance');
        if (usdtEl) usdtEl.textContent = (Number(usdtBal) / 1e6).toFixed(2);

        const tokenBalance = await contract.methods.balanceOf(accounts[0], config.hpolyTokenId).call();
        document.getElementById('tokenBalance').textContent = tokenBalance;

        // getPlayerState returns 5 values now: [position, balance, hasStarted, pointsEarned, debt]
        const state = await contract.methods.getPlayerState(accounts[0]).call();
        document.getElementById('points').textContent = state[3];

        // Show debt if the display element exists
        const debtEl = document.getElementById('debtDisplay');
        if (debtEl) debtEl.textContent = state[4];

        const nextReq = await contract.methods.nextRequiredHPOLY(accounts[0]).call();
        document.getElementById('nextRequiredHPOLY').textContent = nextReq;

        const totalSupply = await contract.methods.totalHPOLYSupply().call();
        document.getElementById('totalSupply').textContent = totalSupply;

        const claimPointBtn = document.getElementById('claimPointBtn');
        if (Number(tokenBalance) >= Number(nextReq) && Number(nextReq) > 0) {
            claimPointBtn.disabled = false;
            claimPointBtn.classList.remove('disabled');
            claimPointBtn.classList.add('enabled');
        } else {
            claimPointBtn.disabled = true;
            claimPointBtn.classList.remove('enabled');
            claimPointBtn.classList.add('disabled');
        }

        const hasMinted = await contract.methods.hasMintedInitial(accounts[0]).call();
        const mintBtn = document.getElementById('mintTokensBtn');
        mintBtn.disabled = hasMinted;
        if (hasMinted) {
            mintBtn.textContent = "HPOLY Minted";
            mintBtn.style.backgroundColor = "#4CAF50";
        }

        const creditsEl = document.getElementById('boostCredits');
        if (creditsEl) {
            const r = await contract.methods.rerollCredits(accounts[0]).call();
            const d = await contract.methods.doubleRewardCredits(accounts[0]).call();
            creditsEl.textContent = (Number(r) > 0 || Number(d) > 0)
                ? `Credits – Reroll: ${r} | Double: ${d}` : "";
        }
    } catch (error) {
        console.error("Update UI Error:", error);
        addLogEntry(`Error updating balances: ${error.message}`, 'loss');
    }
}

async function updateGameState() {
    if (!contract || !accounts[0]) return;
    try {
        const player = await contract.methods.getPlayerState(accounts[0]).call();
        gameStarted = player.hasStarted;
        if (gameStarted) {
            currentPlayerPosition = Number(player.position);
            document.getElementById('playerPosition').textContent = currentPlayerPosition;
            document.getElementById('playerBalance').textContent = player.balance;
            const token = document.getElementById('player-token');
            token.style.left = tilePositions[currentPlayerPosition].left;
            token.style.top = tilePositions[currentPlayerPosition].top;
            document.getElementById('rollDiceBtn').disabled = false;
            document.getElementById('endGameBtn').disabled = false;
            highlightCurrentPosition(currentPlayerPosition);
        } else {
            document.getElementById('rollDiceBtn').disabled = true;
            document.getElementById('endGameBtn').disabled = true;
        }
        document.getElementById('playerStatus').textContent = gameStarted ? "Active" : "Not Started";
        document.getElementById('playerStatus').style.color = gameStarted ? "#4CAF50" : "#F44336";
    } catch (error) {
        console.error("Update Game State Error:", error);
        addLogEntry(`Error updating game state: ${error.message}`, 'loss');
    }
}

function highlightCurrentPosition(position) {
    for (let i = 0; i < config.boardSize; i++) {
        const tile = document.getElementById(`tile-${i}`);
        if (!tile) continue;
        tile.style.boxShadow = 'none';
        tile.style.zIndex = '1';
    }
    const currentTile = document.getElementById(`tile-${position}`);
    if (currentTile) {
        currentTile.style.boxShadow = '0 0 15px var(--hedera-pink)';
        currentTile.style.zIndex = '10';
    }
}

async function showTileDetails(tileId) {
    try {
        const tileDetails = await contract.methods.getTile(tileId).call();
        const panel = document.getElementById('tileDetails');
        panel.style.display = 'block';
        document.getElementById('tileName').textContent = tileDetails[0];
        let tileType;
        switch (String(tileDetails[1])) {
            case '0': tileType = "NEUTRAL"; break;
            case '1': tileType = "PROFIT"; break;
            case '2': tileType = "LOSS"; break;
            default: tileType = "UNKNOWN";
        }
        document.getElementById('tileType').textContent = tileType;
        document.getElementById('tileValue').textContent = tileDetails[2];
    } catch (error) {
        console.error("Tile Details Error:", error);
        addLogEntry(`Error getting tile details: ${error.message}`, 'loss');
    }
}

function addLogEntry(message, type = 'neutral') {
    const log = document.getElementById('logEntries');
    const entry = document.createElement('div');
    entry.className = `log-entry log-entry-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// ============ RAINING MONEY ANIMATION ============
const canvas = document.getElementById('moneyRain');
if (canvas) {
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const symbols = ['💵', '💰', '💸', '🤑', '💎', '🪙', '💴', '💶', '💷', '🟩', '💚', 'BOT'];
    const fontSize = 24;
    const columns = canvas.width / fontSize;
    const drops = [];
    for (let i = 0; i < columns; i++) drops[i] = Math.random() * -100;

    function draw() {
        ctx.fillStyle = 'rgba(0, 15, 0, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < drops.length; i++) {
            const text = symbols[Math.floor(Math.random() * symbols.length)];
            const x = i * fontSize;
            const y = drops[i] * fontSize;
            ctx.fillStyle = '#00ff88';
            ctx.shadowColor = '#00ff41';
            ctx.shadowBlur = 20;
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.fillText(text, x, y);
            ctx.fillStyle = 'rgba(0, 255, 136, 0.3)';
            ctx.shadowBlur = 40;
            ctx.fillText(text, x + 5, y - 10);
            drops[i]++;
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        }
    }
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
    setInterval(draw, 35);
}