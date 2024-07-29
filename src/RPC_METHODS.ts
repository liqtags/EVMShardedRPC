import EVM from '@liqtags/evm';
import EVM_STATE from '@liqtags/evm-state';
import { EVM_METADATA } from '@liqtags/evm-metadata';
import keccak256 from 'keccak256'
import MEMPOOL from '@liqtags/mempool';
import { Transaction } from '@ethereumjs/tx';
import { web3_sha3 } from './methods/web3_sha3';
import Web3 from 'web3';
let MEMPOOL = [];
let options = { chainId: 420, protocolVersionInHex: '0x3f', gasPriceInWeiAndHex: '0x77359400', clientVersion: '', };
const web3 = new Web3();

type RPCMethodHandler = (...args: any[]) => Promise<any> | any;
const RPC_METHODS: any = new Map<string, RPCMethodHandler>();
const convertToHex = (value: string | number | bigint): string => web3.utils.toHex(value.toString());

const JSON_RETURN_RESULT = (result: any, id: any) => {
    return {
        jsonrpc: '2.0',
        result,
        id,
    };
}

RPC_METHODS.set('eth_chainId', () => options.chainId);
RPC_METHODS.set('eth_protocolVersion', () => options.protocolVersionInHex);
RPC_METHODS.set('eth_syncing', () => false);
RPC_METHODS.set('eth_gasPrice', () => options.gasPriceInWeiAndHex);
RPC_METHODS.set('eth_blockNumber', (_, shard: string) => EVM_METADATA[shard].nextBlockIndex);
RPC_METHODS.set('eth_getBalance', async (params: [string, string]) => {
    const [address, _] = params;
    const account = await EVM.getAccount(address).catch(() => false);
    if (account) {
        return convertToHex(account.balance);
    } else {
        return { error: 'Impossible to get account' };
    }
});

RPC_METHODS.set('eth_getTransactionCount', async (params: [string, string]) => {
    const [address, _] = params;
    const account = await EVM.getAccount(address).catch(() => false);
    if (account) {
        return convertToHex(account.nonce);
    } else {
        return { error: 'Impossible to get account' };
    }
});

RPC_METHODS.set('eth_getCode', async (params: [string, string]) => {
    const [address, _] = params;
    const account = await EVM.getAccount(address).catch(() => false);
    if (account) {
        return '0x' + Buffer.from(account.codeHash).toString('hex');
    } else {
        return { error: 'Impossible to get account' };
    }
});

RPC_METHODS.set('eth_sendRawTransaction', async (params: [string]) => {
    const [serializedTransactionInHexWith0x] = params;
    const result = await EVM.sandboxCall(serializedTransactionInHexWith0x).catch(() => false);

    if (result) {
        if (result.error) return { error: JSON.stringify(result) };

        MEMPOOL.push({ type: 'EVM_CALL', payload: serializedTransactionInHexWith0x });

        try {
            // @ts-ignore
            const tx = Transaction.fromSerializedTx(Buffer.from(serializedTransactionInHexWith0x.slice(2), 'hex'));
            return `0x${tx.hash().toString('hex')}`;
        } catch {
            return { error: 'Impossible to parse transaction to get hash. Make sure tx format is ok' };
        }
    } else {
        return { error: 'Impossible to run transaction in sandbox. Make sure tx format is ok' };
    }
});

RPC_METHODS.set('eth_call', async (params: [any]) => {
    const [transactionData] = params;
    const executionResultInHex = await EVM.sandboxCall(transactionData, true).catch(() => false);

    if (typeof executionResultInHex === 'string') return executionResultInHex;
    else if (executionResultInHex && executionResultInHex.error) return { error: JSON.stringify(executionResultInHex) };
    else return { error: 'Impossible to run transaction in sandbox. Make sure tx format is ok' };
});

RPC_METHODS.set('eth_estimateGas', async (params: [any]) => {
    const [txData] = params;
    const gasRequiredInHexOrError = await EVM.estimateGasUsed(txData).catch(() => false);

    if (typeof gasRequiredInHexOrError === 'string') return gasRequiredInHexOrError;
    else if (gasRequiredInHexOrError && gasRequiredInHexOrError.error) return { error: JSON.stringify(gasRequiredInHexOrError) };
    else return { error: 'Impossible to run transaction in sandbox to estimate required amount of gas. Make sure tx format is ok' };
});

RPC_METHODS.set('eth_getBlockByNumber', async (params: [string, boolean], shard: string) => {
    const [blockNumberInHex, _] = params;
    const block = await EVM_STATE.get(`${shard}:EVM_BLOCK:${blockNumberInHex}`).catch(() => false);
    return block || { error: 'No block with such index' };
});

RPC_METHODS.set('eth_getBlockByHash', async (params: [string, boolean], shard: string) => {
    const [blockHash, _] = params;
    const blockIndex = await EVM_STATE.get(`${shard}:EVM_INDEX:${blockHash}`).catch(() => false);
    const block = blockIndex ? await EVM_STATE.get(`${shard}:EVM_BLOCK:${blockIndex}`).catch(() => false) : false;
    return block || { error: 'No block with such hash' };
});

RPC_METHODS.set('eth_getTransactionByHash', async (params: [string]) => {
    const [txHash] = params;
    const { tx } = await EVM_STATE.get('TX:' + txHash.slice(2)).catch(() => ({ tx: false }));
    return tx || { error: 'No such transaction. Make sure that hash is ok' };
});

RPC_METHODS.set('eth_getTransactionReceipt', async (params: [string]) => {
    const [txHash] = params;
    const { receipt } = await EVM_STATE.get('TX:' + txHash).catch(() => ({ receipt: false }));
    return receipt || false;
});

RPC_METHODS.set('eth_getLogs', async (params: [any], shard: string) => {
    const [queryOptions] = params;
    const { fromBlock, toBlock, address, topics } = queryOptions;

    let currentBlockIndex: bigint;

    const fromBlockIsHex = web3.utils.isHex(fromBlock);
    const toBlockIsHex = web3.utils.isHex(toBlock);

    if ((fromBlockIsHex || fromBlock === 'latest') && (toBlockIsHex || toBlock === 'latest')) {
        if (fromBlock === 'latest' || toBlock === 'latest') {
            currentBlockIndex = EVM.getCurrentBlock().header.number;
        }

        let fromBlockBigInt = fromBlockIsHex ? BigInt(fromBlock) :
            (fromBlock === 'latest' ? currentBlockIndex : BigInt(0));

        let toBlockBigInt = toBlockIsHex ? BigInt(toBlock) :
            (toBlock === 'latest' ? currentBlockIndex : BigInt(0));

        const arrayWithLogsToResponse = [];

        while (fromBlockBigInt <= toBlockBigInt) {
            const blockLogs = await EVM_STATE.get(`${shard}:EVM_LOGS:${convertToHex(fromBlockBigInt)}`).catch(() => false);

            if (blockLogs) {
                const contractRelatedArrayOfLogs = blockLogs[address];

                if (contractRelatedArrayOfLogs) {
                    contractRelatedArrayOfLogs.forEach(
                        (singleLog: { topics: any[] }) =>
                            singleLog.topics.toString() === topics.toString() && arrayWithLogsToResponse.push(singleLog)
                    );
                }
            }

            fromBlockBigInt = fromBlockBigInt + BigInt(1);
        }

        return arrayWithLogsToResponse;
    } else {
        return { error: `Wrong values of <fromBlock> or <toBlock>. Possible values are: <block_index_in_hex> | 'latest'` };
    }
});

RPC_METHODS.set('web3_clientVersion', (params): any => options.clientVersion);

RPC_METHODS.set('web3_sha3', async (params: [string]) => await web3_sha3(params));

export { RPC_METHODS, JSON_RETURN_RESULT };