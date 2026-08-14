"use client";

import { useMemo, useState } from "react";

type WorkItem = { client:string; code:string; service:string; period:string; owner:string; due:string; status:"Overdue"|"At risk"|"Waiting"|"In review"; detail:string };

const workItems:WorkItem[] = [
  {client:"Aarav Retail Private Limited",code:"AR",service:"GSTR-3B",period:"Jul 2026",owner:"Nisha",due:"Today",status:"At risk",detail:"2B reconciliation has 18 unresolved invoices"},
  {client:"Koshi Infra LLP",code:"KI",service:"TDS 26Q",period:"Q1 FY 26-27",owner:"Rahul",due:"2 days ago",status:"Overdue",detail:"Challan allocation is incomplete"},
  {client:"Neelam Foods",code:"NF",service:"Book close",period:"Jul 2026",owner:"Vikram",due:"Tomorrow",status:"Waiting",detail:"Bank statement requested from client"},
  {client:"Brightpath Foundation",code:"BF",service:"Form 10B",period:"AY 2026-27",owner:"Priya",due:"22 Aug",status:"In review",detail:"Partner review pending on two clauses"},
  {client:"Saanvi Exports",code:"SE",service:"LUT & Export",period:"FY 2026-27",owner:"Nisha",due:"25 Aug",status:"Waiting",detail:"Client approval and export invoice set awaited"},
];
const nav=["Home","My Work","Clients","Compliance","Documents","Calendar","Team","Billing","Reports"];
const statusClass:Record<WorkItem["status"],string>={Overdue:"overdue","At risk":"risk",Waiting:"waiting","In review":"review"};

export default function Home(){
  const [active,setActive]=useState("Home");
  const [filter,setFilter]=useState("All");
  const [query,setQuery]=useState("");
  const [menu,setMenu]=useState(false);
  const visible=useMemo(()=>workItems.filter(w=>(filter==="All"||w.status===filter)&&(!query||`${w.client} ${w.service} ${w.owner}`.toLowerCase().includes(query.toLowerCase()))),[filter,query]);
  return <main className="app-shell">
    <aside className={`sidebar ${menu?"open":""}`}>
      <div className="brand"><div className="brand-mark">S</div><div><b>SISPL</b><span>CA Solution</span></div><button onClick={()=>setMenu(false)} className="close">×</button></div>
      <button className="firm"><span className="firm-logo">SK</span><span><small>Current firm</small><b>Sharma & Kumar</b></span><i>⌄</i></button>
      <p className="nav-title">Workspace</p>
      <nav>{nav.map(item=><button key={item} onClick={()=>{setActive(item);setMenu(false)}} className={active===item?"nav active":"nav"}><i>{item[0]}</i><span>{item}</span>{item==="My Work"&&<b>12</b>}</button>)}</nav>
      <div className="side-bottom"><button className="nav"><i>?</i><span>Help & support</span></button><div className="profile"><span>LK</span><div><b>Loukesh Kumar</b><small>Firm administrator</small></div><i>•••</i></div></div>
    </aside>
    {menu&&<button aria-label="Close menu" className="overlay" onClick={()=>setMenu(false)}/>} 
    <section className="workspace">
      <header className="topbar"><button className="hamburger" onClick={()=>setMenu(true)}>☰</button><label className="search"><i>⌕</i><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search clients, PAN, GSTIN or work…"/><kbd>⌘ K</kbd></label><div className="top-actions"><button className="bell">♢<i/></button><button className="quick">＋ <span>Quick create</span></button></div></header>
      <div className="content">
        <section className="welcome"><div><small>FRIDAY, 14 AUGUST 2026</small><h1>{active==="Home"?"Good evening, Loukesh":active}</h1><p>Here is what needs your firm’s attention today.</p></div><div className="welcome-actions"><button>FY 2026–27⌄</button><button>Open my work →</button></div></section>
        <section className="stats">
          {[["08","Overdue work","+3 this week","Overdue","red"],["23","Due in next 7 days","5 due today","At risk","amber"],["31","Waiting on client","14 clients","Waiting","blue"],["12","Pending review","6 with partner","In review","teal"]].map(([number,label,trend,target,color])=><button onClick={()=>setFilter(target)} className={`stat ${color}`} key={label}><div><i>{color==="red"?"!":color==="amber"?"◷":color==="blue"?"⇧":"✓"}</i><small>{trend}</small></div><strong>{number}</strong><p>{label}</p><span>View details →</span></button>)}
        </section>
        <div className="dashboard-grid">
          <section className="panel attention"><div className="panel-head"><div><h2>Attention needed</h2><p>Work ranked by risk, deadline and dependency</p></div><button onClick={()=>setFilter("All")}>View all</button></div><div className="filters">{["All","Overdue","At risk","Waiting","In review"].map(item=><button key={item} onClick={()=>setFilter(item)} className={filter===item?"active":""}>{item}</button>)}</div><div className="work-list">{visible.map(w=><article className="work" key={w.client+w.service}><div className="client-code">{w.code}</div><div className="work-copy"><div><b>{w.client}</b><span className={`tag ${statusClass[w.status]}`}>{w.status}</span></div><p>{w.service} · {w.period}</p><small>{w.detail}</small></div><div className="meta"><small>Owner</small><b>{w.owner}</b></div><div className="meta due"><small>Due</small><b>{w.due}</b></div><button className="open-row">→</button></article>)}{visible.length===0&&<div className="empty">No work matches this search.</div>}</div></section>
          <aside className="right-panels">
            <section className="panel health"><div className="panel-head"><div><h2>Compliance health</h2><p>August 2026</p></div><i>•••</i></div><div className="health-main"><div className="ring"><div><b>86%</b><span>On track</span></div></div><div className="legend"><span><i className="g"/>Completed <b>142</b></span><span><i className="a"/>In progress <b>37</b></span><span><i className="r"/>At risk <b>18</b></span></div></div><div className="bars">{[["GST",88],["TDS",76],["Income Tax",91],["ROC",68]].map(([n,v])=><div key={n}><span>{n}</span><i><b style={{width:`${v}%`}}/></i><strong>{v}%</strong></div>)}</div></section>
            <section className="panel team"><div className="panel-head"><div><h2>Team workload</h2><p>This week</p></div><button>Manage</button></div>{[["NS","Nisha S.",92,"Overloaded"],["RK","Rahul K.",78,"High"],["PM","Priya M.",61,"Balanced"],["VR","Vikram R.",43,"Available"]].map(([initials,name,value,label],idx)=><div className="person" key={name}><span className={`avatar a${idx}`}>{initials}</span><div><p><b>{name}</b><small>{label}</small></p><i><b style={{width:`${value}%`}}/></i></div><strong>{value}%</strong></div>)}</section>
          </aside>
        </div>
      </div>
    </section>
  </main>
}
