# RocketPool-Subgraph

Subgraph for RocketPool dApp

V 2.0.0

This subgraph is not officially owned by the Rocket Pool team (yet). This is a community contribution by Data Nexus & VGR with the aims to transfer ownership to the Rocket Pool dev team.

Version 2 includes Redstone and Atlas contracts.

**[Rocket Pool Subgraph](https://thegraph.com/explorer/subgraphs/S9ihna8D733WTEShJ1KctSTCvY1VJ7gdVwhUujq4Ejo?view=Overview&chain=mainnet)**

**Graph Query Documentation** https://thegraph.com/docs/en/developer/graphql-api/

**Creating an api key for queries** https://www.youtube.com/watch?v=UrfIpm-Vlgs

## **Example Queries 🖥️**

**Graphiql Query Builder:** https://graphiql-online.com/

### Pull the rETH 30day APY:

NOTE: Calculation is the number of seconds in a year divided by the difference in seconds of the two time period, then multiply by the percentage difference between the two periods. With this method you can easily change 30day to 7day/1year etc. by changing the `skip: 30` in the second entity. 31536000 / (yesterdayRETH.blockTime - thirtyDayRETH.blockTime) \* ((yesterdayRETH.rETHExchangeRate - thirtyDayRETH.rETHExchangeRate) / thirtyDayRETH.rETHExchangeRate)

```graphql
query rETHAPY {
  yesterdayRETH: rocketETHDailySnapshots(first: 1, skip: 1, orderBy: blockTime, orderDirection: desc) {
    rETHExchangeRate
    blockTime
    block
  }
  thirtyDayRETH: rocketETHDailySnapshots(first: 1, skip: 30, orderBy: blockTime, orderDirection: desc) {
    rETHExchangeRate
    blockTime
    block
  }
}
```

### Pull the rETH Staker Information for an individual address:

NOTE: id's should be be all lowercase

```graphql
query StakerOverview {
  staker(id: "0x...") {
    rETHBalance
    totalETHRewards
    ethBalance
    id
  }
}
```

### Get the users underlying ETH rewards since staking

NOTES: id's should be all lowercase

```graphql
{
  staker(id: "0x0000000000000000000000000000000000000000") {
    avgEntry
    AvgEntryTime
    rETHBalance
  }
  currentExchange: rocketETHDailySnapshots(first: 1, orderBy: blockTime, orderDirection: desc) {
    rETHExchangeRate
  }
}
```

### Pull the daily eth rewards for a staker:

```graphql
query StakerOverTime {
  staker(id: "0x...") {
    id
    rETHBalance
  }
  rocketETHDailySnapshots(first: 7) {
    rETHExchangeRate
  }
}
```
