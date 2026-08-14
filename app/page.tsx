"use client";
import {useMemo,useState} from "react";

type Work={client:string;initials:string;service:string;period:string;owner:string;ownerInitials:string;due:string;status:"Critical"|"At risk"|"Waiting"|"Review";note:string;progress:number;color:string};
const work:Work[]=[
 {client:"Koshi Infra LLP",initials:"KI",service:"TDS 26Q",period:"Q1 · FY 26–27",owner:"Rahul K.",ownerInitials:"RK",due:"12 Aug",status:"Critical",note:"Challan allocation incomplete",progress:64,color:"violet"},
 {client:"Aarav Retail Pvt. Ltd.",initials:"AR",service:"GSTR-3B",period:"July 2026",owner:"Nisha S.",ownerInitials:"NS",due:"Today",status:"At risk",note:"18 invoices need reconciliation",progress:78,color:"blue"},
 {client:"Neelam Foods",initials:"NF",service:"Monthly close",period:"July 2026",owner:"Vikram R.",ownerInitials:"VR",due:"Tomorrow",status:"Waiting",note:"Bank statement awaited",progress:46,color:"orange"},
 {client:"Brightpath Foundation",initials:"BF",service:"Form 10B",period:"AY 2026–27",owner:"Priya M.",ownerInitials:"PM",due:"22 Aug",status:"Review",note:"Partner review · 2 clauses",progress:88,color:"green"},
];
const navigation=["Overview","My work","Clients","Compliance","Documents","Calendar","Team","Billing","Insights"];
const icons=["⌂","✓","◇","◫","▱","□","♙","₹","⌁"];

export default function Dashboard(){
 const [active,setActive]=useState("Overview"); const [filter,setFilter]=useState("All"); const [query,setQuery]=useState(""); const [menu,setMenu]=useState(false);
 const items=useMemo(()=>work.filter(x=>(filter==="All"||x.status===filter)&&(!query||(`${x.client} ${x.service} ${x.owner}`).toLowerCase().includes(query.toLowerCase()))),[filter,query]);
 return <main className="shell">
  <aside className={`side ${menu?"show":""}`}>
   <div className="logo"><div>S</div><span><b>SISPL</b><small>CA SOLUTION</small></span><button onClick={()=>setMenu(false)}>×</button></div>
   <button className="firm-card"><span>SK</span><div><small>ACTIVE FIRM</small><b>Sharma & Kumar</b><em>Chartered Accountants</em></div><i>⌄</i></button>
   <p className="section-label">MAIN MENU</p>
   <nav>{navigation.map((n,i)=><button key={n} onClick={()=>{setActive(n);setMenu(false)}} className={active===n?"active":""}><i>{icons[i]}</i><span>{n}</span>{n==="My work"&&<em>12</em>}</button>)}</nav>
   <div className="upgrade"><span>✦</span><b>Practice health</b><p>Your firm is performing better than 86% this month.</p><div><i/><b>86%</b></div><button>View insights →</button></div>
   <div className="account"><span>LK</span><div><b>Loukesh Kumar</b><small>Firm administrator</small></div><button>•••</button></div>
  </aside>
  {menu&&<button className="backdrop" onClick={()=>setMenu(false)}/>} 
  <section className="main">
   <header><button className="menu" onClick={()=>setMenu(true)}>☰</button><label className="global-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search clients, PAN, GSTIN, tasks…"/><kbd>⌘ K</kbd></label><div className="header-actions"><button className="fy">FY 2026–27⌄</button><button className="notify">♢<i/></button><button className="add">＋ <span>Create new</span></button></div></header>
   <div className="page">
    <section className="title-row"><div><p><span>LIVE</span> Friday, 14 August</p><h1>{active==="Overview"?"Your practice, in command.":active}</h1><small>Good evening, Loukesh. Here’s the pulse of your firm today.</small></div><div className="title-actions"><button>Export report</button><button>Open my work <span>→</span></button></div></section>

    <section className="pulse-card">
     <div className="pulse-glow one"/><div className="pulse-glow two"/>
     <div className="pulse-copy"><span className="pulse-kicker">TODAY’S OPERATIONS PULSE</span><h2>8 deadlines need<br/><em>your attention.</em></h2><p>Three are blocked by client documents and two are waiting for partner review.</p><div className="pulse-actions"><button>Review critical work →</button><span><i>NS</i><i>RK</i><i>PM</i><b>5 team members active</b></span></div></div>
     <div className="pulse-visual"><div className="orbit outer"><i/><i/><i/></div><div className="orbit middle"/><div className="pulse-score"><span>ON-TIME RATE</span><b>92<small>%</small></b><em>↑ 4.8% this month</em></div><div className="float-card fc1"><span>✓</span><div><b>142</b><small>Completed</small></div></div><div className="float-card fc2"><span>!</span><div><b>08</b><small>Overdue</small></div></div></div>
    </section>

    <section className="metrics">
     <button onClick={()=>setFilter("Critical")}><div className="metric-icon red">!</div><div><span>OVERDUE</span><b>08</b><small><i>↑ 3</i> since Monday</small></div><div className="spark red-spark"><i/><i/><i/><i/><i/><i/><i/></div></button>
     <button onClick={()=>setFilter("At risk")}><div className="metric-icon gold">◷</div><div><span>DUE THIS WEEK</span><b>23</b><small><i>5</i> due today</small></div><div className="spark gold-spark"><i/><i/><i/><i/><i/><i/><i/></div></button>
     <button onClick={()=>setFilter("Waiting")}><div className="metric-icon blue">⇧</div><div><span>WAITING ON CLIENT</span><b>31</b><small><i>14</i> clients</small></div><div className="spark blue-spark"><i/><i/><i/><i/><i/><i/><i/></div></button>
     <button onClick={()=>setFilter("Review")}><div className="metric-icon mint">✓</div><div><span>PENDING REVIEW</span><b>12</b><small><i>6</i> with partner</small></div><div className="spark mint-spark"><i/><i/><i/><i/><i/><i/><i/></div></button>
    </section>

    <section className="bento">
     <div className="work-panel card"><div className="card-head"><div><span className="mini-kicker">PRIORITY QUEUE</span><h3>Attention needed</h3><p>Ranked by risk, deadline and dependency</p></div><button>View all work →</button></div><div className="tabs">{["All","Critical","At risk","Waiting","Review"].map(x=><button key={x} className={filter===x?"active":""} onClick={()=>setFilter(x)}>{x}{x==="All"&&<i>12</i>}</button>)}</div><div className="work-table"><div className="table-labels"><span>CLIENT & ASSIGNMENT</span><span>PROGRESS</span><span>OWNER</span><span>DUE DATE</span><span/></div>{items.map(x=><article key={x.client}><div className="client"><span className={x.color}>{x.initials}</span><div><b>{x.client}</b><p>{x.service}<i>•</i>{x.period}<em className={x.status.toLowerCase().replace(" ","")}>{x.status}</em></p><small>{x.note}</small></div></div><div className="progress"><div><i style={{width:`${x.progress}%`}}/></div><span>{x.progress}%</span></div><div className="owner"><span>{x.ownerInitials}</span><b>{x.owner}</b></div><div className="deadline"><b>{x.due}</b><small>{x.status==="Critical"?"2 days overdue":x.status==="At risk"?"8 hours left":"Upcoming"}</small></div><button className="go">→</button></article>)}{!items.length&&<div className="empty">No work matches your search.</div>}</div></div>
     <aside className="insight-column">
      <div className="health-card card"><div className="card-head"><div><span className="mini-kicker">COMPLIANCE</span><h3>Health score</h3></div><button>•••</button></div><div className="health-body"><div className="donut"><div><b>86</b><span>/100</span><small>Excellent</small></div></div><div className="health-copy"><span><i className="good"/>On track <b>142</b></span><span><i className="warn"/>In progress <b>37</b></span><span><i className="bad"/>At risk <b>18</b></span></div></div><div className="service-list">{[["GST","88%","+3.2"],["Income Tax","91%","+5.4"],["TDS","76%","-1.8"],["ROC","68%","+2.1"]].map(([n,v,c])=><div key={n}><span>{n}</span><div><i style={{width:v}}/></div><b>{v}</b><em className={c.startsWith("-")?"down":""}>{c}%</em></div>)}</div></div>
      <div className="deadline-card card"><div className="card-head"><div><span className="mini-kicker">UPCOMING</span><h3>Deadline radar</h3></div><button>Calendar →</button></div><div className="deadline-list"><article><time><b>16</b><small>AUG</small></time><div><b>GSTR-1 · IFF</b><small>7 clients · 2 not started</small></div><span className="urgent">2 days</span></article><article><time><b>20</b><small>AUG</small></time><div><b>GSTR-3B</b><small>14 clients · 5 at risk</small></div><span>6 days</span></article><article><time><b>31</b><small>AUG</small></time><div><b>TDS payment</b><small>9 deductors · On track</small></div><span>17 days</span></article></div></div>
     </aside>
    </section>
   </div>
  </section>
 </main>
}
