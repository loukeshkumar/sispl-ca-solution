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

type ClientRecord={name:string;short:string;type:string;pan:string;gstins:number;owner:string;services:string[];health:number;risk:"Healthy"|"Watch"|"Critical";next:string;missing:number;city:string;joined:string};
const clients:ClientRecord[]=[
 {name:"Aarav Retail Private Limited",short:"AR",type:"Private Company",pan:"AABCA••••F",gstins:3,owner:"Nisha S.",services:["GST","TDS","Books"],health:74,risk:"Watch",next:"GSTR-3B · Today",missing:18,city:"Patna, Bihar",joined:"Apr 2023"},
 {name:"Koshi Infra LLP",short:"KI",type:"LLP",pan:"AAEFK••••Q",gstins:2,owner:"Rahul K.",services:["GST","TDS","Audit","ROC"],health:58,risk:"Critical",next:"TDS 26Q · Overdue",missing:4,city:"Gurugram, Haryana",joined:"Jul 2022"},
 {name:"Brightpath Foundation",short:"BF",type:"Trust / NPO",pan:"AABTB••••K",gstins:1,owner:"Priya M.",services:["ITR","Audit","10B"],health:91,risk:"Healthy",next:"Form 10B · 22 Aug",missing:0,city:"New Delhi",joined:"Jan 2024"},
 {name:"Saanvi Exports",short:"SE",type:"Partnership",pan:"AALFS••••C",gstins:4,owner:"Nisha S.",services:["GST","LUT","Books"],health:82,risk:"Healthy",next:"Export recon · 25 Aug",missing:7,city:"Kolkata, West Bengal",joined:"Oct 2021"},
 {name:"Neelam Foods",short:"NF",type:"Proprietorship",pan:"BRQPN••••D",gstins:1,owner:"Vikram R.",services:["GST","Books","ITR"],health:69,risk:"Watch",next:"Book close · Tomorrow",missing:2,city:"Noida, Uttar Pradesh",joined:"May 2025"},
];

function ClientsModule(){
 const [selected,setSelected]=useState<ClientRecord>(clients[0]); const [segment,setSegment]=useState("All clients"); const [search,setSearch]=useState("");
 const visible=clients.filter(c=>(segment==="All clients"||c.risk===segment)&&(!search||c.name.toLowerCase().includes(search.toLowerCase())));
 return <div className="clients-module">
  <section className="clients-title"><div><p><span>PORTFOLIO</span> 148 active clients</p><h1>Client command centre</h1><small>Manage entities, registrations, engagements and compliance health from one place.</small></div><div><button>⇧ Import clients</button><button>＋ Add new client</button></div></section>
  <section className="client-metrics"><article><span className="cm violet">◇</span><div><small>CLIENT GROUPS</small><b>126</b><em>148 legal entities</em></div></article><article><span className="cm blue">▦</span><div><small>GST REGISTRATIONS</small><b>219</b><em>17 states covered</em></div></article><article><span className="cm mint">✓</span><div><small>HEALTHY PORTFOLIO</small><b>86%</b><em>↑ 4.2% this month</em></div></article><article><span className="cm coral">!</span><div><small>NEED ATTENTION</small><b>19</b><em>6 critical clients</em></div></article></section>
  <section className="client-layout">
   <div className="portfolio card"><div className="portfolio-tools"><label><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client or PAN…"/></label><div>{["All clients","Healthy","Watch","Critical"].map(x=><button key={x} onClick={()=>setSegment(x)} className={segment===x?"active":""}>{x}</button>)}</div><button className="filter-btn">☷ Filters</button></div><div className="portfolio-head"><span>CLIENT / ENTITY</span><span>SERVICES</span><span>HEALTH</span><span>NEXT OBLIGATION</span><span>OWNER</span></div>{visible.map(c=><button className={selected.name===c.name?"portfolio-row selected":"portfolio-row"} key={c.name} onClick={()=>setSelected(c)}><div className="entity-cell"><span>{c.short}</span><div><b>{c.name}</b><small>{c.type} · PAN {c.pan}</small><em>{c.gstins} GSTIN{c.gstins>1?"s":""}</em></div></div><div className="service-chips">{c.services.slice(0,3).map(s=><span key={s}>{s}</span>)}{c.services.length>3&&<i>+{c.services.length-3}</i>}</div><div className="client-health"><div><i style={{width:c.health+"%"}}/></div><b>{c.health}%</b><em className={c.risk.toLowerCase()}>{c.risk}</em></div><div className="next-item"><b>{c.next}</b><small>{c.missing?c.missing+" items missing":"Everything ready"}</small></div><div className="portfolio-owner"><span>{c.owner.split(" ").map(x=>x[0]).join("")}</span><b>{c.owner}</b></div></button>)}</div>
   <aside className="client-360 card"><div className="c360-cover"><div className="c360-orb one"/><div className="c360-orb two"/><span>{selected.short}</span><div><small>{selected.risk.toUpperCase()} CLIENT</small><h2>{selected.name}</h2><p>{selected.type} · {selected.city}</p></div><button>•••</button></div><div className="c360-tabs"><button className="active">Overview</button><button>Compliance</button><button>Documents</button><button>Billing</button></div><div className="c360-body"><div className="profile-health"><div><span>RELATIONSHIP HEALTH</span><b>{selected.health}<small>/100</small></b><em className={selected.risk.toLowerCase()}>{selected.risk}</em></div><div className="mini-ring" style={{background:"conic-gradient(#6f5ce7 0 "+selected.health+"%,#eeecfb "+selected.health+"%)"}}><i/></div></div><section><p className="detail-label">REGISTRATIONS & IDENTITY</p><div className="detail-grid"><div><small>PAN</small><b>{selected.pan}</b></div><div><small>GSTIN</small><b>{selected.gstins} active</b></div><div><small>Relationship since</small><b>{selected.joined}</b></div><div><small>Owner</small><b>{selected.owner}</b></div></div></section><section><p className="detail-label">ACTIVE SERVICES</p><div className="active-services">{selected.services.map((s,i)=><span key={s}><i>{["◇","₹","◫","▱"][i%4]}</i>{s}<b>Active</b></span>)}</div></section><section><p className="detail-label">NEXT ACTION</p><div className="next-action"><span>◷</span><div><b>{selected.next}</b><small>{selected.missing?selected.missing+" documents or exceptions need attention":"Ready for completion"}</small></div><button>Open →</button></div></section><div className="c360-actions"><button>Request document</button><button>Open Client 360 →</button></div></div></aside>
  </section>
 </div>
}

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
    {active==="Clients"?<ClientsModule/>:<>
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
    </>}
   </div>
  </section>
 </main>
}
