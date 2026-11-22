"use client";

import Link from "next/link";
import { ArrowUpRight, Search, X } from "lucide-react";
import { useState } from "react";
import { tools } from "../lib/tools";
import { ToolIcon } from "./tool-icon";

const categories = ["All tools", "Create", "Organize", "Edit", "Convert"] as const;

export function Catalogue() {
  const [category, setCategory] = useState<(typeof categories)[number]>("All tools");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = tools.filter((tool) =>
    (category === "All tools" || tool.category === category) &&
    `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(needle));

  return (
    <section className="container catalogue" id="tools" aria-labelledby="tools-title">
      <div className="catalogue-header">
        <h2 id="tools-title">PDF tools</h2>
        <div className="search-control">
          <Search size={18} aria-hidden="true" />
          <input type="search" aria-label="Search tools" placeholder="Search tools" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" className="icon-button" aria-label="Clear search" onClick={(event) => {
            const input = event.currentTarget.parentElement?.querySelector("input");
            setQuery("");
            input?.focus();
          }}><X size={16} aria-hidden="true" /></button>}
        </div>
      </div>
      <div className="catalogue-filters" aria-label="Filter by category" role="group">
        {categories.map((item) => <button type="button" key={item} className="filter" aria-pressed={item === category} onClick={() => setCategory(item)}>{item}</button>)}
        <p className="tool-count" role="status">{visible.length} {visible.length === 1 ? "tool" : "tools"}</p>
      </div>
      {visible.length > 0 ? <ul className="tool-grid">
        {visible.map((tool) => (
          <li key={tool.id} className="reveal">
            <Link className="tool-card" href={`/tools/${tool.id}`}>
              <div className="card-top"><ToolIcon tool={tool} /><ArrowUpRight className="card-arrow" size={20} aria-hidden="true" /></div>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
            </Link>
          </li>
        ))}
      </ul> : <div className="empty-search"><p>No tools match your search.</p><button type="button" className="button secondary" onClick={() => { setQuery(""); setCategory("All tools"); }}>Show all tools</button></div>}
    </section>
  );
}
