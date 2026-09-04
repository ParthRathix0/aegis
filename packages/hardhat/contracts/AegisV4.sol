// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Aegis Protocol V4.0 — Two-Asset Base/Quote Swap
 * @notice Fair, MEV-resistant batch settlement with real base/quote token swaps
 * @dev Extends V3 to support BUY (deposit quote) / SELL (deposit base) two-asset batches
 */

interface IOracle {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract AegisV4 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ===== ENUMS =====
    enum BatchState {
        OPEN,           // Users deposit orders
        ACCUMULATING,   // Oracle price collection
        DISPUTING,      // User dispute window
        SETTLING        // Execute trades & update weights
    }

    enum Side {
        BUY,
        SELL
    }

    // ===== STRUCTS =====
    
    /**
     * @dev Oracle information with dynamic weight
     */
    struct OracleInfo {
        address oracleAddress;
        uint256 weight;              // Range: [1, 1000]
        uint256 techStackId;         // 1=Chainlink, 2=Pyth, 3=API3 (Hydra Defense)
        uint256 lastPrice;           // Last valid price recorded
        uint256 lastUpdateBlock;     // For staleness check
        bool isActive;               // Can be deactivated by owner
        uint256 successfulBatches;   // For Probation
    }

    /**
     * @dev Single price observation from an oracle
     */
    struct PriceObservation {
        uint256 price;
        uint256 blockNumber;
        bool isValid;                // False if rejected by 10% filter
    }

    /**
     * @dev Per-batch oracle statistics
     */
    struct OracleStats {
        uint256[] observations;      // All price observations
        uint256 trimmedAverage;      // Computed after scrubbing
        int256 delta1;               // Accuracy + precision score (basis points)
        int256 delta2;               // Dispute-based adjustment (basis points)
        bool ignored;                // True if deviation > 10% from others
    }

    /**
     * @dev User order information
     */
    struct UserOrder {
        uint256 amount;
        Side side;
        bool claimed;
        bool disputed;
    }

    /**
     * @dev Batch data structure
     */
    struct Batch {
        BatchState state;
        address asset;
        uint256 openEnd;
        uint256 accumulationEnd;
        uint256 disputeEnd;
        uint256 settlingEnd;
        uint256 settlementPrice;
        uint256 buyVolume;
        uint256 sellVolume;
        uint256 buyDisputedVolume;
        uint256 sellDisputedVolume;
        mapping(address => UserOrder) orders;
        address[] users;
        mapping(uint256 => OracleStats) oracleStats;  // oracleId => stats
    }

    // ===== CONSTANTS =====
    uint256 public constant OPEN_DURATION = 50;           
    uint256 public constant ACCUMULATION_DURATION = 48;   
    uint256 public constant DISPUTE_DURATION = 15;        
    uint256 public constant SETTLING_DURATION = 10;       
    
    uint256 public constant COLLECTION_INTERVAL = 4;      
    uint256 public constant MAX_PRICE_DEVIATION = 10;     // 10% max deviation filter
    uint256 public constant NEIGHBOR_DEVIATION_PCT = 5;   // 5% neighbor check (Scrubbing)
    uint256 public constant TRIM_PERCENT = 10;            // Trim 10% from each end
    uint256 public constant ORACLE_DEVIATION_THRESHOLD = 10; 
    
    uint256 public constant DISPUTE_VOID_THRESHOLD = 33;  // 33% dispute voids batch
    uint256 public constant CIRCUIT_BREAKER_THRESHOLD = 50; // 50% price move voids batch
    uint256 public constant HYDRA_THRESHOLD = 10;         // 10% move triggers strict diversity check

    uint256 public constant WEIGHT_MIN = 1;
    uint256 public constant WEIGHT_MAX = 1000;
    uint256 public constant WEIGHT_DEFAULT = 100;
    uint256 public constant PROBATION_BATCHES = 10;
    
    uint256 public constant BASIS_POINTS = 10000;         
    uint256 public constant PRECISION = 1e18;

    // ===== STATE VARIABLES =====
    address public baseAsset;   // e.g. WETH (18 dec)
    address public quoteAsset;  // e.g. USDC (6 dec)

    uint256 public maxStaleness = 3600; // seconds; owner-tunable for real Chainlink heartbeats
    uint256 public batchCounter;
    mapping(uint256 => Batch) public batches;
    
    // Oracle registry
    uint256 public oracleCount;
    mapping(uint256 => OracleInfo) public oracles;        
    mapping(address => uint256) public oracleAddressToId; 
    
    uint256 public currentBatchId;
    uint256 public lastCollectionBlock;
    uint256 public lastSettlementPrice; // For Circuit Breaker

    // ===== EVENTS =====
    event BatchCreated(uint256 indexed batchId, address asset, uint256 openEnd);
    event BatchStateChanged(uint256 indexed batchId, BatchState newState, uint256 endBlock);
    event Deposited(uint256 indexed batchId, address indexed user, uint256 amount, Side side);
    event OracleRegistered(uint256 indexed oracleId, address oracleAddress, uint256 stackId);
    event OraclePriceCollected(uint256 indexed batchId, uint256 indexed oracleId, uint256 price, bool isValid);
    event OracleWeightUpdated(uint256 indexed oracleId, uint256 oldWeight, uint256 newWeight, int256 delta1, int256 delta2);
    event Disputed(uint256 indexed batchId, address indexed user, Side side, uint256 amount);
    event BatchSettled(uint256 indexed batchId, uint256 settlementPrice, uint256 buyFillRatio, uint256 sellFillRatio);
    event BatchVoided(uint256 indexed batchId, string reason);
    event Claimed(uint256 indexed batchId, address indexed user, uint256 filled, uint256 refunded);

    // ===== CONSTRUCTOR =====
    constructor(address _baseAsset, address _quoteAsset) Ownable(msg.sender) {
        require(_baseAsset != address(0) && _quoteAsset != address(0), "bad assets");
        baseAsset = _baseAsset;
        quoteAsset = _quoteAsset;
        _createBatch(_baseAsset);
    }

    // ===== ORACLE MANAGEMENT =====

    /**
     * @notice Register a new oracle with Tech Stack ID (Hydra Defense)
     * @param _oracleAddress Address of the oracle contract
     * @param _techStackId 1=Chainlink, 2=Pyth, 3=API3, etc.
     */
    function registerOracle(address _oracleAddress, uint256 _techStackId) external onlyOwner returns (uint256) {
        require(_oracleAddress != address(0), "Invalid oracle address");
        require(oracleAddressToId[_oracleAddress] == 0, "Oracle already registered");
        require(_techStackId > 0, "Invalid Stack ID");
        
        oracleCount++;
        uint256 oracleId = oracleCount;
        
        oracles[oracleId] = OracleInfo({
            oracleAddress: _oracleAddress,
            weight: WEIGHT_MIN, // Start on Probation (1)
            techStackId: _techStackId,
            lastPrice: 0,
            lastUpdateBlock: 0,
            isActive: true,
            successfulBatches: 0
        });
        
        oracleAddressToId[_oracleAddress] = oracleId;
        
        emit OracleRegistered(oracleId, _oracleAddress, _techStackId);
        return oracleId;
    }

    function deactivateOracle(uint256 _oracleId) external onlyOwner {
        require(_oracleId > 0 && _oracleId <= oracleCount, "Invalid oracle ID");
        oracles[_oracleId].isActive = false;
    }

    function setMaxStaleness(uint256 _seconds) external onlyOwner {
        require(_seconds > 0, "Staleness must be > 0");
        maxStaleness = _seconds;
    }

    function activateOracle(uint256 _oracleId) external onlyOwner {
        require(_oracleId > 0 && _oracleId <= oracleCount, "Invalid oracle ID");
        oracles[_oracleId].isActive = true;
    }

    // ===== BATCH LIFECYCLE =====

    function _createBatch(address _asset) internal returns (uint256) {
        uint256 batchId = batchCounter++;
        Batch storage batch = batches[batchId];
        
        batch.state = BatchState.OPEN;
        batch.asset = _asset;
        batch.openEnd = block.number + OPEN_DURATION;
        batch.accumulationEnd = batch.openEnd + ACCUMULATION_DURATION;
        batch.disputeEnd = batch.accumulationEnd + DISPUTE_DURATION;
        batch.settlingEnd = batch.disputeEnd + SETTLING_DURATION;
        
        currentBatchId = batchId;
        
        emit BatchCreated(batchId, _asset, batch.openEnd);
        return batchId;
    }

    function setBatchAsset(address _asset) external onlyOwner {
        Batch storage batch = batches[currentBatchId];
        require(batch.state == BatchState.OPEN, "Can only set asset in OPEN state");
        require(batch.users.length == 0, "Cannot change asset after deposits");
        batch.asset = _asset;
    }

    function deposit(uint256 _amount, Side _side) external nonReentrant {
        Batch storage batch = batches[currentBatchId];
        require(
            batch.state == BatchState.OPEN || batch.state == BatchState.ACCUMULATING,
            "Batch not accepting deposits"
        );
        require(block.number < batch.accumulationEnd, "Deposit phase ended");
        require(_amount > 0, "Amount must be > 0");
        require(batch.asset != address(0), "Asset not set");

        // Transfer tokens — BUY deposits quote, SELL deposits base
        address inToken = _side == Side.BUY ? quoteAsset : baseAsset;
        IERC20(inToken).safeTransferFrom(msg.sender, address(this), _amount);

        // Record order
        if (batch.orders[msg.sender].amount == 0) {
            batch.users.push(msg.sender);
        }
        
        batch.orders[msg.sender].amount += _amount;
        batch.orders[msg.sender].side = _side;

        // Update volume
        if (_side == Side.BUY) {
            batch.buyVolume += _amount;
        } else {
            batch.sellVolume += _amount;
        }

        emit Deposited(currentBatchId, msg.sender, _amount, _side);
    }

    function startAccumulation() external {
        Batch storage batch = batches[currentBatchId];
        require(batch.state == BatchState.OPEN, "Not in OPEN state");
        require(block.number >= batch.openEnd, "OPEN phase not ended");

        batch.state = BatchState.ACCUMULATING;
        batch.accumulationEnd = block.number + ACCUMULATION_DURATION;
        lastCollectionBlock = block.number;

        emit BatchStateChanged(currentBatchId, BatchState.ACCUMULATING, batch.accumulationEnd);
    }

    function collectOraclePrices() external {
        Batch storage batch = batches[currentBatchId];
        require(batch.state == BatchState.ACCUMULATING, "Not in ACCUMULATING state");
        require(block.number < batch.accumulationEnd, "ACCUMULATING phase ended");
        require(block.number >= lastCollectionBlock + COLLECTION_INTERVAL, "Too early to collect");

        lastCollectionBlock = block.number;

        for (uint256 i = 1; i <= oracleCount; i++) {
            OracleInfo storage oracle = oracles[i];
            if (!oracle.isActive) continue;

            try IOracle(oracle.oracleAddress).latestRoundData() returns (
                uint80,
                int256 answer,
                uint256,
                uint256 updatedAt,
                uint80
            ) {
                if (block.timestamp - updatedAt > maxStaleness) {
                    emit OraclePriceCollected(currentBatchId, i, 0, false);
                    continue;
                }

                uint256 price = uint256(answer);
                bool isValid = true;

                if (oracle.lastPrice > 0) {
                    uint256 deviation = _calculateDeviation(price, oracle.lastPrice);
                    if (deviation > MAX_PRICE_DEVIATION) {
                        isValid = false;
                    }
                }

                if (isValid) {
                    batch.oracleStats[i].observations.push(price);
                    oracle.lastPrice = price;
                }

                oracle.lastUpdateBlock = block.number;
                emit OraclePriceCollected(currentBatchId, i, price, isValid);

            } catch {
                emit OraclePriceCollected(currentBatchId, i, 0, false);
            }
        }
    }

    function startDispute() external {
        Batch storage batch = batches[currentBatchId];
        require(batch.state == BatchState.ACCUMULATING, "Not in ACCUMULATING state");
        require(block.number >= batch.accumulationEnd, "ACCUMULATING phase not ended");

        // Compute settlement price and delta_1
        _computeSettlementPrice(currentBatchId);
        
        // Only compute delta1 if batch wasn't voided during price computation
        if (batch.state != BatchState.OPEN) { 
            _computeDelta1(currentBatchId);
            batch.state = BatchState.DISPUTING;
            batch.disputeEnd = block.number + DISPUTE_DURATION;
            emit BatchStateChanged(currentBatchId, BatchState.DISPUTING, batch.disputeEnd);
        }
    }

    function dispute() external nonReentrant {
        Batch storage batch = batches[currentBatchId];
        require(batch.state == BatchState.DISPUTING, "Not in DISPUTING state");
        require(block.number < batch.disputeEnd, "DISPUTING phase ended");
        require(batch.orders[msg.sender].amount > 0, "No order to dispute");
        require(!batch.orders[msg.sender].disputed, "Already disputed");
        require(!batch.orders[msg.sender].claimed, "Already claimed");

        UserOrder storage order = batch.orders[msg.sender];
        order.disputed = true;

        uint256 amount = order.amount;
        Side side = order.side;

        if (side == Side.BUY) {
            batch.buyDisputedVolume += amount;
        } else {
            batch.sellDisputedVolume += amount;
        }

        emit Disputed(currentBatchId, msg.sender, side, amount);
    }

    function startSettling() external {
        Batch storage batch = batches[currentBatchId];
        require(batch.state == BatchState.DISPUTING, "Not in DISPUTING state");
        require(block.number >= batch.disputeEnd, "DISPUTING phase not ended");

        uint256 totalVolume = batch.buyVolume + batch.sellVolume;
        uint256 maxDisputedVolume = batch.buyDisputedVolume > batch.sellDisputedVolume 
            ? batch.buyDisputedVolume 
            : batch.sellDisputedVolume;

        uint256 disputeRatio = (maxDisputedVolume * 100) / totalVolume;

        if (disputeRatio > DISPUTE_VOID_THRESHOLD) {
            _voidBatch(currentBatchId, "Dispute threshold exceeded");
            return;
        }

        _computeDelta2(currentBatchId, disputeRatio);

        batch.state = BatchState.SETTLING;
        batch.settlingEnd = block.number + SETTLING_DURATION;

        emit BatchStateChanged(currentBatchId, BatchState.SETTLING, batch.settlingEnd);
    }

    function executeSettlement() external {
        Batch storage batch = batches[currentBatchId];
        require(batch.state == BatchState.SETTLING, "Not in SETTLING state");
        require(block.number >= batch.settlingEnd, "SETTLING phase not ended");

        _updateOracleWeights(currentBatchId);

        uint256 buyFillRatio = _calculateFillRatio(batch.buyVolume, batch.sellVolume, true);
        uint256 sellFillRatio = _calculateFillRatio(batch.buyVolume, batch.sellVolume, false);

        lastSettlementPrice = batch.settlementPrice;

        emit BatchSettled(currentBatchId, batch.settlementPrice, buyFillRatio, sellFillRatio);

        _createBatch(batch.asset);
    }

    function _voidBatch(uint256 _batchId, string memory _reason) internal {
        Batch storage batch = batches[_batchId];
        batch.state = BatchState.OPEN; // Reuse OPEN as VOIDED state
        emit BatchVoided(_batchId, _reason);
        _createBatch(batch.asset);
    }

    // ===== CLAIMING =====

    function claim(uint256 _batchId) external nonReentrant {
        Batch storage batch = batches[_batchId];
        UserOrder storage order = batch.orders[msg.sender];
        
        require(order.amount > 0, "No order");
        require(!order.claimed, "Already claimed");

        order.claimed = true;

        uint256 filled = 0;
        uint256 refunded = 0;

        if (order.disputed || batch.state == BatchState.OPEN) {
            refunded = order.amount;
        } else {
            uint256 fillRatio = _calculateFillRatio(batch.buyVolume, batch.sellVolume, order.side == Side.BUY);
            filled = (order.amount * fillRatio) / PRECISION;
            refunded = order.amount - filled;
        }

        uint256 total = filled + refunded;
        if (total > 0) {
            IERC20(batch.asset).safeTransfer(msg.sender, total);
        }

        emit Claimed(_batchId, msg.sender, filled, refunded);
    }

    // ===== INTERNAL CALCULATIONS =====

    /**
     * @notice Data Scrubbing: Neighbor Check + Sort + Trim
     */
    function _scrubData(uint256[] memory raw) internal pure returns (uint256, bool) {
        uint256 len = raw.length;
        if (len == 0) return (0, false);
        if (len == 1) return (raw[0], true);

        // 1. NEIGHBOR CHECK
        uint256[] memory validNeighbors = new uint256[](len);
        uint256 vCount = 0;

        for (uint256 i = 0; i < len; i++) {
            bool bad = false;
            if (i > 0) {
                uint256 prev = raw[i-1];
                uint256 diffPrev = raw[i] > prev ? raw[i] - prev : prev - raw[i];
                if ((diffPrev * 100) / prev > NEIGHBOR_DEVIATION_PCT) {
                    if (i < len - 1) {
                        uint256 next = raw[i+1];
                        uint256 diffNext = raw[i] > next ? raw[i] - next : next - raw[i];
                        if ((diffNext * 100) / next > NEIGHBOR_DEVIATION_PCT) {
                            bad = true; // Deviates from BOTH
                        }
                    }
                }
            }
            if (!bad) {
                validNeighbors[vCount] = raw[i];
                vCount++;
            }
        }

        if (vCount == 0) return (0, false);

        // 2. SORT (Bubble sort)
        for (uint256 i = 0; i < vCount; i++) {
            for (uint256 j = i + 1; j < vCount; j++) {
                if (validNeighbors[i] > validNeighbors[j]) {
                    uint256 temp = validNeighbors[i];
                    validNeighbors[i] = validNeighbors[j];
                    validNeighbors[j] = temp;
                }
            }
        }

        // 3. TRIM (10%)
        uint256 trimCount = (vCount * TRIM_PERCENT) / 100;
        if (vCount <= 2 * trimCount) return (0, false);

        uint256 sum = 0;
        uint256 counted = 0;
        for (uint256 i = trimCount; i < vCount - trimCount; i++) {
            sum += validNeighbors[i];
            counted++;
        }

        if (counted == 0) return (0, false);
        return (sum / counted, true);
    }

    function _computeSettlementPrice(uint256 _batchId) internal {
        Batch storage batch = batches[_batchId];
        uint256[] memory oracleAvgs = new uint256[](oracleCount + 1);
        uint256 validCount = 0;

        for (uint256 i = 1; i <= oracleCount; i++) {
            OracleStats storage stats = batch.oracleStats[i];
            
            // USE SCRUBBING ENGINE
            (uint256 scrubbedPrice, bool valid) = _scrubData(stats.observations);
            
            if (valid) {
                oracleAvgs[i] = scrubbedPrice;
                stats.trimmedAverage = scrubbedPrice;
                validCount++;
            } else {
                stats.ignored = true;
            }
        }

        if (validCount < 2) {
            _voidBatch(_batchId, "Insufficient valid oracles");
            return;
        }

        // --- CLUSTER ANALYSIS (Detect Outliers) ---
        uint256[] memory sortedAvgs = new uint256[](validCount);
        uint256[] memory sortedIds = new uint256[](validCount);
        uint256 idx = 0;

        for (uint256 i = 1; i <= oracleCount; i++) {
            if (!batch.oracleStats[i].ignored && oracleAvgs[i] > 0) {
                sortedAvgs[idx] = oracleAvgs[i];
                sortedIds[idx] = i;
                idx++;
            }
        }

        // Sort by price
        for (uint256 i = 1; i < validCount; i++) {
            uint256 keyAvg = sortedAvgs[i];
            uint256 keyId = sortedIds[i];
            uint256 j = i;
            while (j > 0 && sortedAvgs[j - 1] > keyAvg) {
                sortedAvgs[j] = sortedAvgs[j - 1];
                sortedIds[j] = sortedIds[j - 1];
                j--;
            }
            sortedAvgs[j] = keyAvg;
            sortedIds[j] = keyId;
        }

        // Filter outliers (>10% dev)
        for (uint256 i = 0; i < validCount - 1; i++) {
            uint256 deviation = _calculateDeviation(sortedAvgs[i + 1], sortedAvgs[i]);
            if (deviation > ORACLE_DEVIATION_THRESHOLD) {
                batch.oracleStats[sortedIds[i + 1]].ignored = true;
            }
        }

        // Compute weighted price
        uint256 totalWeight = 0;
        uint256 weightedSum = 0;
        // Tracking for Hydra
        uint256[] memory usedStacks = new uint256[](oracleCount + 1); 
        uint256 stackCount = 0;

        for (uint256 i = 1; i <= oracleCount; i++) {
            if (!batch.oracleStats[i].ignored && oracleAvgs[i] > 0) {
                uint256 weight = oracles[i].weight;
                
                // Probation Check
                if (oracles[i].successfulBatches < PROBATION_BATCHES) {
                    weight = WEIGHT_MIN; 
                }

                weightedSum += oracleAvgs[i] * weight;
                totalWeight += weight;
                
                uint256 sId = oracles[i].techStackId;
                if (usedStacks[sId] == 0) {
                    usedStacks[sId] = 1;
                    stackCount++;
                }
            }
        }

        if (totalWeight == 0) {
            _voidBatch(_batchId, "No valid weighted oracles");
            return;
        }
        
        uint256 finalPrice = weightedSum / totalWeight;

        // --- ADVERSARIAL CHECKS (Circuit Breaker + Hydra) ---
        if (lastSettlementPrice > 0) {
            uint256 delta = finalPrice > lastSettlementPrice 
                ? finalPrice - lastSettlementPrice 
                : lastSettlementPrice - finalPrice;
            uint256 pctChange = (delta * 100) / lastSettlementPrice;

            // 1. CIRCUIT BREAKER (50%)
            if (pctChange > CIRCUIT_BREAKER_THRESHOLD) {
                _voidBatch(_batchId, "CIRCUIT_BREAKER_TRIGGERED");
                return;
            }

            // 2. HYDRA DEFENSE (10%)
            if (pctChange > HYDRA_THRESHOLD) {
                // If price moved >10%, we require at least 2 different tech stacks
                if (stackCount < 2) {
                    _voidBatch(_batchId, "HYDRA_DIVERSITY_FAIL");
                    return;
                }
            }
        }

        batch.settlementPrice = finalPrice;
    }

    function _computeDelta1(uint256 _batchId) internal {
        Batch storage batch = batches[_batchId];
        uint256 settlementPrice = batch.settlementPrice;

        for (uint256 i = 1; i <= oracleCount; i++) {
            OracleStats storage stats = batch.oracleStats[i];
            if (stats.observations.length == 0) continue;

            uint256 x = _calculateDeviation(stats.trimmedAverage, settlementPrice);
            
            uint256 y = 0;
            if (stats.observations.length > 1) {
                uint256 sumDev = 0;
                for (uint256 j = 0; j < stats.observations.length; j++) {
                    uint256 dev = _calculateDeviation(stats.observations[j], stats.trimmedAverage);
                    sumDev += dev;
                }
                y = sumDev / stats.observations.length;
            }

            // Delta 1 = -2x² - 3y² + 1000
            int256 accuracyPenalty = -2 * int256(x * x);
            int256 precisionPenalty = -3 * int256(y * y);
            int256 bonus = 1000; 

            stats.delta1 = accuracyPenalty + precisionPenalty + bonus;
        }
    }

    function _computeDelta2(uint256 _batchId, uint256 _disputeRatio) internal {
        Batch storage batch = batches[_batchId];
        if (_disputeRatio == 0) {
            for (uint256 i = 1; i <= oracleCount; i++) {
                batch.oracleStats[i].delta2 = 0;
            }
            return;
        }

        bool isBuyerDispute = batch.buyDisputedVolume > batch.sellDisputedVolume;
        uint256[] memory sortedIds = new uint256[](oracleCount);
        uint256[] memory sortedPrices = new uint256[](oracleCount);
        
        for (uint256 i = 1; i <= oracleCount; i++) {
            sortedIds[i - 1] = i;
            sortedPrices[i - 1] = batch.oracleStats[i].trimmedAverage;
        }

        for (uint256 i = 0; i < oracleCount - 1; i++) {
            for (uint256 j = i + 1; j < oracleCount; j++) {
                if (sortedPrices[i] > sortedPrices[j]) {
                    (sortedPrices[i], sortedPrices[j]) = (sortedPrices[j], sortedPrices[i]);
                    (sortedIds[i], sortedIds[j]) = (sortedIds[j], sortedIds[i]);
                }
            }
        }

        int256[] memory basePenalties = new int256[](oracleCount);
        int256 sumPenalties = 0;

        for (uint256 i = 0; i < oracleCount; i++) {
            basePenalties[i] = -int256(i + 1);
            sumPenalties += basePenalties[i];
        }

        int256 scaleFactor = int256(_disputeRatio * BASIS_POINTS / DISPUTE_VOID_THRESHOLD);
        
        for (uint256 i = 0; i < oracleCount; i++) {
            basePenalties[i] = (basePenalties[i] * scaleFactor) / int256(BASIS_POINTS);
        }

        int256 meanPenalty = sumPenalties / int256(oracleCount);
        
        for (uint256 i = 0; i < oracleCount; i++) {
            int256 normalized = basePenalties[i] - meanPenalty;
            if (!isBuyerDispute) normalized = -normalized;
            batch.oracleStats[sortedIds[i]].delta2 = normalized;
        }
    }

    function _updateOracleWeights(uint256 _batchId) internal {
        Batch storage batch = batches[_batchId];

        for (uint256 i = 1; i <= oracleCount; i++) {
            OracleInfo storage oracle = oracles[i];
            OracleStats storage stats = batch.oracleStats[i];

            if (stats.observations.length == 0) continue;

            uint256 oldWeight = oracle.weight;
            int256 newWeightInt = int256(oldWeight) + (int256(oldWeight) * stats.delta1) / int256(BASIS_POINTS);
            newWeightInt = newWeightInt + (newWeightInt * stats.delta2) / int256(BASIS_POINTS);

            uint256 newWeight;
            if (newWeightInt < int256(WEIGHT_MIN)) {
                newWeight = WEIGHT_MIN;
            } else if (newWeightInt > int256(WEIGHT_MAX)) {
                newWeight = WEIGHT_MAX;
            } else {
                newWeight = uint256(newWeightInt);
            }

            oracle.weight = newWeight;
            
            // Increment probation counter if performance was good
            if (newWeight >= oldWeight) {
                oracle.successfulBatches++;
            }

            emit OracleWeightUpdated(i, oldWeight, newWeight, stats.delta1, stats.delta2);
        }
    }

    function _calculateFillRatio(uint256 _buyVolume, uint256 _sellVolume, bool _isBuy) internal pure returns (uint256) {
        if (_buyVolume == 0 || _sellVolume == 0) return 0;
        if (_isBuy) {
            return _buyVolume <= _sellVolume ? PRECISION : (_sellVolume * PRECISION) / _buyVolume;
        } else {
            return _sellVolume <= _buyVolume ? PRECISION : (_buyVolume * PRECISION) / _sellVolume;
        }
    }

    function _calculateDeviation(uint256 _value1, uint256 _value2) internal pure returns (uint256) {
        if (_value2 == 0) return 0;
        uint256 diff = _value1 > _value2 ? _value1 - _value2 : _value2 - _value1;
        return (diff * 100) / _value2;
    }

    function _sortArray(uint256[] memory _array) internal pure returns (uint256[] memory) {
        uint256[] memory sorted = new uint256[](_array.length);
        for (uint256 i = 0; i < _array.length; i++) sorted[i] = _array[i];
        for (uint256 i = 1; i < sorted.length; i++) {
            uint256 key = sorted[i];
            uint256 j = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = key;
        }
        return sorted;
    }

    // ===== VIEW FUNCTIONS =====

    function getBatchState(uint256 _batchId) external view returns (BatchState) {
        return batches[_batchId].state;
    }

    function getOracleInfo(uint256 _oracleId) external view returns (OracleInfo memory) {
        return oracles[_oracleId];
    }

    function getOracleStats(uint256 _batchId, uint256 _oracleId) external view returns (
        uint256 observationCount,
        uint256 trimmedAverage,
        int256 delta1,
        int256 delta2,
        bool ignored
    ) {
        OracleStats storage stats = batches[_batchId].oracleStats[_oracleId];
        return (
            stats.observations.length,
            stats.trimmedAverage,
            stats.delta1,
            stats.delta2,
            stats.ignored
        );
    }

    function getUserOrder(uint256 _batchId, address _user) external view returns (
        uint256 amount,
        Side side,
        bool claimed,
        bool disputed
    ) {
        UserOrder storage order = batches[_batchId].orders[_user];
        return (order.amount, order.side, order.claimed, order.disputed);
    }

    function getCurrentBatchInfo() external view returns (
        uint256 batchId,
        BatchState state,
        uint256 endBlock,
        uint256 buyVolume,
        uint256 sellVolume,
        uint256 settlementPrice
    ) {
        Batch storage batch = batches[currentBatchId];
        uint256 end;
        
        if (batch.state == BatchState.OPEN) end = batch.openEnd;
        else if (batch.state == BatchState.ACCUMULATING) end = batch.accumulationEnd;
        else if (batch.state == BatchState.DISPUTING) end = batch.disputeEnd;
        else if (batch.state == BatchState.SETTLING) end = batch.settlingEnd;

        return (
            currentBatchId,
            batch.state,
            end,
            batch.buyVolume,
            batch.sellVolume,
            batch.settlementPrice
        );
    }
}