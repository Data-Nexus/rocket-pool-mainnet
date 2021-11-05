import { Address, Bytes, ethereum } from '@graphprotocol/graph-ts'
import { ROCKETPOOL_THEGRAPH_HELPER_CONTACT_ADDRESS_NAME } from '../constants/contractconstants'

/**
 * Helper class that returns the passed in key as keccak256(abi.encodePacked("contract.address", [key]))
 */
export class TheGraphRPHelperContract extends ethereum.SmartContract {
    static get(): TheGraphRPHelperContract {
      return new TheGraphRPHelperContract("rocketPoolTheGraphHelper", Address.fromString(ROCKETPOOL_THEGRAPH_HELPER_CONTACT_ADDRESS_NAME));
    }
  
    getContractAddress(key: string): Bytes {
      let result = super.call(
        "getContractAddress",
        "getContractAddress(string):(bytes32)",
        [ethereum.Value.fromString(key)]
      );
  
      return result[0].toBytes();
    }
}