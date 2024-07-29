import keccak256 from 'keccak256';

export async function web3_sha3(params: [string]): Promise<any> {
    if (!params || params.length !== 1) return { error: 'Invalid number of parameters' }
    if (typeof params[0] === 'string') return '0x' + keccak256(params[0]).toString('hex')
    else return { error: 'Parameter is not a string' }
}