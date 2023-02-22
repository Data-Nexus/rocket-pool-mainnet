import {
  NodeRegistered as NodeRegisteredEvent,
  NodeRewardNetworkChanged as NodeRewardNetworkChangedEvent,
  NodeSmoothingPoolStateChanged as NodeSmoothingPoolStateChangedEvent,
  NodeTimezoneLocationSet as NodeTimezoneLocationSetEvent,
} from "../../generated/rocketSmoothingPool/rocketSmoothingPool";
import {Node} from "../../generated/schema";
import {handleNodeRegister} from "./rocketNodeManager";
import {rocketNodeManager, NodeRegistered, NodeTimezoneLocationSet} from "../../generated/rocketNodeManager/rocketNodeManager";

export function handleNodeRegistered(event: NodeRegisteredEvent): void {
  let newNode = new NodeRegistered(
    event.address,
    event.logIndex,
    event.transactionLogIndex,
    event.logType,
    event.block,
    event.transaction,
    event.parameters,
    event.receipt
  );
  handleNodeRegister(newNode);
}

export function handleNodeSmoothingPoolStateChanged(event: NodeSmoothingPoolStateChangedEvent): void {
  let node = Node.load(event.params.node.toHexString());

  // node must exist prior to entering the smoothing pool
  if (!node) return;

  node.smoothingPool = event.params.state;
}

// export function handleNodeRewardNetworkChanged(event: NodeRewardNetworkChangedEvent): void {
//   let entity = new NodeRewardNetworkChanged(event.transaction.hash.concatI32(event.logIndex.toI32()));
//   entity.node = event.params.node;
//   entity.network = event.params.network;

//   entity.blockNumber = event.block.number;
//   entity.blockTimestamp = event.block.timestamp;
//   entity.transactionHash = event.transaction.hash;

//   entity.save();
// }

// export function handleNodeTimezoneLocationSet(event: NodeTimezoneLocationSetEvent): void {
//   let entity = new NodeTimezoneLocationSet(event.transaction.hash.concatI32(event.logIndex.toI32()));
//   entity.node = event.params.node;
//   entity.time = event.params.time;

//   entity.blockNumber = event.block.number;
//   entity.blockTimestamp = event.block.timestamp;
//   entity.transactionHash = event.transaction.hash;

//   entity.save();
// }
