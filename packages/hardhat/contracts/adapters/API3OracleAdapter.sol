// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IApi3Proxy {
    function read() external view returns (int224 value, uint32 timestamp);
}

/// @notice Exposes an API3 dAPI proxy as Chainlink-style latestRoundData() at 8 decimals.
contract API3OracleAdapter {
    IApi3Proxy public immutable proxy;

    constructor(address _proxy) {
        proxy = IApi3Proxy(_proxy);
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        (int224 value, uint32 timestamp) = proxy.read();
        // API3 values are 18 decimals; Aegis expects 8 -> divide by 1e10.
        int256 scaled = int256(value) / 1e10;
        return (uint80(1), scaled, timestamp, timestamp, uint80(1));
    }
}
