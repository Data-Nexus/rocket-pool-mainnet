import {Address, BigInt, Bytes} from "@graphprotocol/graph-ts";
import {Transfer} from "../../generated/rocketTokenRETH/rocketTokenRETH";
import {rocketTokenRETH} from "../../generated/rocketTokenRETH/rocketTokenRETH";
import {Staker} from "../../generated/schema";
import {generalUtilities} from "../utilities/generalutilities";
import {stakerUtilities} from "../utilities/stakerUtilities";
import {rocketPoolEntityFactory} from "../entityfactory";
import {ethereum} from "@graphprotocol/graph-ts";

/**
 * Occurs when a staker transfer an rETH amount to another staker.
 */
export function handleTransfer(event: Transfer): void {
  handleRocketETHTransaction(event, event.params.from, event.params.to, event.params.value);
}

/**
 * General flow of what should happen for a RocketETH transaction.
 */
function handleRocketETHTransaction(event: ethereum.Event, from: Address, to: Address, rETHAmount: BigInt): void {
  // Preliminary check to ensure we haven't handled this before.
  if (stakerUtilities.hasTransactionHasBeenIndexed(event)) return;

  // Who are the stakers for this transaction?
  let stakers = stakerUtilities.getTransactionStakers(from, to, event.block.number, event.block.timestamp);
  if (stakers === null || stakers.fromStaker === null || stakers.toStaker === null) return;

  // Attempt to index this transaction.
  saveTransaction(event, stakers.fromStaker, stakers.toStaker, rETHAmount);
}

/**
 * Save a new Transaction that occured between the FROM and TO staker for a specific rETH amount.
 */
function saveTransaction(event: ethereum.Event, from: Staker, to: Staker, rETHAmount: BigInt): void {
  // This state has to be valid before we can actually do anything.
  if (event === null || from === null || from.id == null || to === null || to.id == null) return;

  // Create a new transaction for the given values.
  let rEthTransaction = rocketPoolEntityFactory.createRocketETHTransaction(
    generalUtilities.extractIdForEntity(event),
    from,
    to,
    rETHAmount,
    event
  );
  if (rEthTransaction === null || rEthTransaction.id == null) return;

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity();
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol();
  }

  // Load the RocketTokenRETH contract.
  let rETHContract = rocketTokenRETH.bind(event.address);
  if (rETHContract === null) return;

  // Update active balances for stakesr.
  let exchangeRate = rETHContract.getExchangeRate();
  stakerUtilities.changeStakerBalances(from, rETHAmount, exchangeRate, false);
  stakerUtilities.changeStakerBalances(to, rETHAmount, exchangeRate, true);

  // Save all indirectly affected entities of the protocol - All stakers
  let protocolStakers = protocol.stakers;
  if (protocolStakers.indexOf(from.id) == -1) protocolStakers.push(from.id);
  if (protocolStakers.indexOf(to.id) == -1) protocolStakers.push(to.id);
  protocol.stakers = protocolStakers;

  // Save all indirectly affected entities of the protocol - Active stakers.
  let protocolActiveStakers = protocol.activeStakers;
  if (from.rETHBalance > BigInt.fromI32(0) && protocolActiveStakers.indexOf(from.id) == -1) {
    protocolActiveStakers.push(from.id);
    protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance.plus(BigInt.fromI32(1));
  } else if (from.rETHBalance == BigInt.fromI32(0) && protocolActiveStakers.indexOf(from.id) != -1) {
    protocolActiveStakers.splice(protocolActiveStakers.indexOf(from.id), 1);
    protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance.minus(BigInt.fromI32(1));
  }

  if (to.rETHBalance > BigInt.fromI32(0) && protocolActiveStakers.indexOf(to.id) == -1) {
    protocolActiveStakers.push(to.id);
    protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance.plus(BigInt.fromI32(1));
  } else if (to.rETHBalance == BigInt.fromI32(0) && protocolActiveStakers.indexOf(to.id) != -1) {
    protocolActiveStakers.splice(protocolActiveStakers.indexOf(to.id), 1);
    protocol.stakersWithAnRETHBalance = protocol.stakersWithAnRETHBalance.minus(BigInt.fromI32(1));
  }
  protocol.activeStakers = protocolActiveStakers;

  if (exchangeRate.gt(BigInt.fromI32(0)) && to.rETHBalance.gt(BigInt.fromI32(0))) {
    // Update Recipient Avg rETH entry
    let priorETH = to.rETHBalance.minus(rETHAmount).times(to.avgEntry);
    let inputETH = rETHAmount.times(exchangeRate);
    let newAvg = priorETH.plus(inputETH).div(to.rETHBalance);
    to.avgEntry = newAvg;

    // Update Recipient Avg rETH entry time using same weights as above
    let priorTime = to.AvgEntryTime.times(priorETH);
    let inputTime = event.block.timestamp.times(inputETH);
    to.AvgEntryTime = priorTime.plus(inputTime).div(to.rETHBalance.times(exchangeRate));
  }

  // zero out avg upon total exit
  if (from.rETHBalance.equals(BigInt.fromI32(0))) {
    from.avgEntry = BigInt.fromI32(0);
    from.AvgEntryTime = BigInt.fromI32(0);
  }

  // Index all state.
  from.save();
  to.save();
  rEthTransaction.save();
  protocol.save();
}
