# RocketPool-Subgraph
Subgraph for RocketPool dApp

V 0.0.1

This subgraph is not officially owned by the Rocket Pool team (yet). This is a community contribution by Data Nexus & VGR with the aims to transfer ownership to the Rocket Pool dev team. 

**[Rocket Pool Subgraph](https://thegraph.com/hosted-service/subgraph/data-nexus/rocket-pool-goerli)**


## **Example Queries 🖥️**

### Pull the rETH Staker Information for an individual address:
NOTE: id's should be be all lowercase 

```bash
query StakerOverview {
staker(id: "0x...") {
  rETHBalance
  totalETHRewards
  ethBalance
  id}
}
```

### Pull the daily eth rewards for a staker:
```bash
query StakerOverview {
  stakerBalanceCheckpoints(where: {stakerId: "0x..."}) {
    rETHBalance
    totalETHRewards
    block
    blockTime
    ethBalance
  }
}
```


