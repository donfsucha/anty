import fs from 'node:fs';
import {tokenizer} from 'acorn';

const source=fs.readFileSync('preflight-verification.js','utf8');
const stream=tokenizer(source,{ecmaVersion:'latest',locations:true});
const stack=[];
const open=new Map([['(',')'],['[',']'],['{','}'],['${','}']]);
const close=new Set([')',']','}']);
try{
  while(true){
    const token=stream.getToken();
    const label=token.type.label;
    if(label==='eof')break;
    if(open.has(label))stack.push({label,expected:open.get(label),line:token.loc.start.line,column:token.loc.start.column});
    else if(close.has(label)){
      const top=stack.at(-1);
      if(!top||top.expected!==label){
        console.log('MISMATCH',label,'at',token.loc.start,'top',top);
      }else stack.pop();
    }
  }
}catch(error){
  console.log('TOKENIZER ERROR',error.message,error.loc||'');
}
console.log('UNMATCHED STACK',JSON.stringify(stack.slice(-20),null,2));
