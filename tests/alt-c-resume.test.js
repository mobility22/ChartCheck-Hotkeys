const fs=require('fs');const src=fs.readFileSync(process.argv[2] || "ChartCheck-Hotkeys.user.js",'utf8');
const fnSrc=src.slice(src.indexOf('    async function reviewUntilFail'),src.indexOf('    async function reviewApproveUntilFail'));
const prelude=`let autoReviewActive=false,autoReviewMode='',autoReviewCount=0;const APPROVE_CHECK_INTERVAL=5;
const currentNonstop=()=>S.nonstop===true;
const currentReviewDelayMs=()=>Number(S.delayMs)||0;
const resetReviewCounts=()=>{autoReviewCount=0};const updateOverlay=()=>{};
const waitForInitialPatientData=async()=>({id:S.idx});const sleep=async(ms)=>{S.sleeps.push(ms)};
const findFailLinks=()=>S.charts[S.idx]?[{click:()=>S.cf.push(S.idx)}]:[];
const getCurrentPatientIdentity=()=>({id:S.idx});const detectPatientSite=()=>'roseville';
const loadNextPatient=()=>{if(S.idx+1>=S.charts.length)return false;S.idx++;if(S.flipAt===S.idx){if(Object.prototype.hasOwnProperty.call(S,'flipTo'))S.nonstop=S.flipTo;if(Object.prototype.hasOwnProperty.call(S,'flipDelay'))S.delayMs=S.flipDelay;}return true};
const waitForPatientIdentityChange=async()=>({id:S.idx});const patientChanged=(a,b)=>a&&b&&a.id!==b.id;
const recordReviewedChart=()=>{autoReviewCount++};const canApproveAndLoadNext=()=>true;
const console={log:()=>{}};`;
const make=new Function('S',prelude+fnSrc+'return reviewUntilFail;');
async function t(name,charts,startIdx,opts,expIdx,expCf,extra){
  const S=Object.assign({charts,idx:startIdx,cf:[],sleeps:[],nonstop:false,delayMs:0},extra||{});
  const f=make(S);await f(0,opts);
  const ok=S.idx===expIdx&&JSON.stringify(S.cf)===JSON.stringify(expCf);
  console.log((ok?'PASS ':'FAIL ')+name+` idx=${S.idx} cf=${JSON.stringify(S.cf)}`);if(!ok)process.exitCode=1;
  return S;
}
(async()=>{
 const charts=[false,false,true,false,false,true,false];
 await t('first run stops at first FAIL',charts,0,{skipInitialFail:true},2,[2]);
 await t('resume from FAIL chart continues to next FAIL',charts,2,{skipInitialFail:true},5,[5]);
 await t('resume after last FAIL runs to end of queue',charts,5,{skipInitialFail:true},6,[]);
 await t('explicit skipInitialFail false stops immediately on same FAIL',charts,2,{skipInitialFail:false},2,[2]);
 await t('default options skip a starting FAIL when Nonstop is off',charts,2,{},5,[5]);
 await t('nonstop continues past every FAIL',charts,0,{},6,[],{nonstop:true});
})();
