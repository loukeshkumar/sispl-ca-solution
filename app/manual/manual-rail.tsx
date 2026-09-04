"use client";

import { useEffect, useState } from "react";

import { manualChapter, manualParts, manualSections } from "../../lib/manual/contents";

/**
 * The contents rail.
 *
 * A twenty-nine chapter page scrolled halfway is a page you are lost in, so the
 * rail marks the chapter that owns the viewport rather than only the one you
 * last clicked. Anchors work without the highlight, so a failure here costs the
 * marker and nothing else.
 */
export default function ManualRail() {
  const [current, setCurrent] = useState(manualSections[0]?.id ?? "");

  useEffect(() => {
    const targets = manualSections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);
    if (!targets.length) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      // The chapter that has crossed the upper third is the one being read.
      const line = window.innerHeight * 0.3;
      let active = targets[0];
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= line) active = target;
      }
      setCurrent(active.id);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <nav aria-label="Manual contents" className="manual-rail">
      <p className="eyebrow">CONTENTS</p>
      <ol>
        {manualParts.map((part) => (
          <li className="manual-rail-part" key={part.label}>
            <p>{part.label}</p>
            <ol>
              {part.sections.map((section) => (
                <li className={section.id === current ? "is-current" : undefined} key={section.id}>
                  <a aria-current={section.id === current ? "true" : undefined} href={`#${section.id}`}>
                    {/* The number is the chapter's, not the rail's, so both agree. */}
                    <span className="manual-rail-number">{manualChapter(section.id).number}</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}
