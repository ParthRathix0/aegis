// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract MockPyth {
    mapping(bytes32 => PythStructs.Price) internal prices;

    function setPrice(bytes32 id, int64 price, int32 expo, uint256 publishTime) external {
        prices[id] = PythStructs.Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
    }

    function getPriceNoOlderThan(bytes32 id, uint256) external view returns (PythStructs.Price memory) {
        return prices[id];
    }
}
