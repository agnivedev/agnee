const j=require(process.argv[2]);const K=['k1','k2','k3','k4','k5','k6','k7','k8'];
const M=['claude-haiku-5.5','gemini-2.5-flash','gpt-5.4-mini'];
const S={};// S[m][run][kasus]=score
for(const [id,v] of Object.entries(j.nilai)){for(const [lab,turns] of Object.entries(v)){const p=j.peta[id][lab];const m=p.model.split('/')[1];
const sc=turns.flatMap(t=>K.map(k=>t[k]).filter(x=>x!=null));((S[m]=S[m]||{})[p.run]=S[m][p.run]||{})[id]=sc.reduce((x,y)=>x+y,0)/(sc.length||1)*50;}}
const ids=Object.keys(j.nilai).filter(i=>process.argv[3]!=='tanpaK18'||i!=='K18');
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1))};
const cs=m=>ids.map(i=>mean([S[m][1][i],S[m][2][i]]));
for(const m of M){const r=[1,2].map(r=>mean(ids.map(i=>S[m][r][i])));console.log(m,'skor',mean(cs(m)).toFixed(1),'run1',r[0].toFixed(1),'run2',r[1].toFixed(1),'sd antar-run',sd(r).toFixed(2))}
function boot(a,b){const d=ids.map((_,i)=>cs(a)[i]-cs(b)[i]);const res=[];let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;for(let t=0;t<5000;t++){let s=0;for(let i=0;i<d.length;i++)s+=d[Math.floor(rnd()*d.length)];res.push(s/d.length)}res.sort((x,y)=>x-y);console.log(a,'-',b,'selisih',mean(d).toFixed(1),'CI95',res[125].toFixed(1),res[4874].toFixed(1))}
boot(M[0],M[1]);boot(M[0],M[2]);boot(M[2],M[1]);
