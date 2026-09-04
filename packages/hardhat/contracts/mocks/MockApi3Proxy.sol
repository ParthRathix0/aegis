// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MockApi3Proxy {
    int224 public value;
    uint32 public ts;
    function set(int224 _v, uint32 _t) external { value = _v; ts = _t; }
    function read() external view returns (int224, uint32) { return (value, ts); }
}
