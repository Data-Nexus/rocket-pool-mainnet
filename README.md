# RocketPool-Subgraph

Subgraph for RocketPool dApp

V 2.0.0

This subgraph is not officially owned by the Rocket Pool team (yet). This is a community contribution by Data Nexus & VGR with the aims to transfer ownership to the Rocket Pool dev team.

**[Rocket Pool Subgraph](https://thegraph.com/explorer/subgraphs/S9ihna8D733WTEShJ1KctSTCvY1VJ7gdVwhUujq4Ejo?view=Overview&chain=mainnet)**

**Graph Query Documentation** https://thegraph.com/docs/en/developer/graphql-api/

**Creating an api key for queries** https://www.youtube.com/watch?v=UrfIpm-Vlgs

## **Example Queries 🖥️**

**Graphiql Query Builder:** https://graphiql-online.com/

### TODO

- Smoothing Pool Interactions (done)
- New RPL functionality (such as stakeRPLFor() on the RocketNodeStaking contract)
- The prior version assumed only 1 BalancesUpdated() would be emitted each day which has lead to missing checkpoints.
- Initial methodology for tracking individuals profits has a cumbersome indexing loop that can be optimized.
- Subgraph should be templated so it can be deployed on the other networks that rETH and RPL are on.

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

### Pull the daily eth rewards for a staker:

```graphql
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
