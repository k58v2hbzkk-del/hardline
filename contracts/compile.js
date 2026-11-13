const solc=require('solc'),fs=require('fs');
const input={language:'Solidity',sources:{'HardlineVault.sol':{content:fs.readFileSync('HardlineVault.sol','utf8')}},
 settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const out=JSON.parse(solc.compile(JSON.stringify(input)));
(out.errors||[]).forEach(e=>console.log(e.severity,e.formattedMessage));
const c=out.contracts['HardlineVault.sol'];
fs.writeFileSync('build.json',JSON.stringify({vault:{abi:c.HardlineVault.abi,bytecode:'0x'+c.HardlineVault.evm.bytecode.object},mock:{abi:c.MockCircuits.abi,bytecode:'0x'+c.MockCircuits.evm.bytecode.object}}));
console.log('vault bytes',c.HardlineVault.evm.bytecode.object.length/2);
