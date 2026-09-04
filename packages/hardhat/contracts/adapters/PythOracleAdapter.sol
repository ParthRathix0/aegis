// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Exposes a Pyth price as a Chainlink-style latestRoundData() at 8 decimals.
contract PythOracleAdapter {
    IPyth public immutable pyth;
    bytes32 public immutable priceId;
    uint256 public constant MAX_AGE = 86400; // testnet-friendly

    constructor(address _pyth, bytes32 _priceId) {
        pyth = IPyth(_pyth);
        priceId = _priceId;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        PythStructs.Price memory p = pyth.getPriceNoOlderThan(priceId, MAX_AGE);
        int256 scaled = _to8dec(p.price, p.expo);
        return (uint80(1), scaled, p.publishTime, p.publishTime, uint80(1));
    }

    function _to8dec(int64 price, int32 expo) internal pure returns (int256) {
        // Convert price * 10^expo into a value with 8 decimals (i.e. * 10^8).
        int256 target = -8;
        int256 diff = int256(expo) - target; // shift needed
        int256 val = int256(price);
        if (diff >= 0) {
            return val * int256(10 ** uint256(diff));
        } else {
            return val / int256(10 ** uint256(-diff));
        }
    }
}
