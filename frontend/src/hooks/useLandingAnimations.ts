"use client";

import { useEffect } from "react";

function revealInViewport(elements: NodeListOf<Element>) {
  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
      el.classList.add("active");
    }
  });
}

export function useLandingAnimations() {
  useEffect(() => {
    document.documentElement.classList.add("landing-motion");

    const nav = document.querySelector(".landing-ufanisi .ufanisi-nav");
    const navToggle = document.querySelector(".landing-ufanisi .mobile-toggle");
    const navLinks = document.querySelector(".landing-ufanisi .nav-links");

    const onScroll = () => {
      nav?.classList.toggle("scrolled", window.scrollY > 40);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const onToggle = () => navLinks?.classList.toggle("is-open");
    navToggle?.addEventListener("click", onToggle);

    const closeMenu = () => navLinks?.classList.remove("is-open");
    navLinks?.querySelectorAll("a, button").forEach((el) => {
      el.addEventListener("click", closeMenu);
    });

    const revealEls = document.querySelectorAll(".landing-ufanisi .reveal");
    let revealObserver: IntersectionObserver | undefined;

    if (revealEls.length) {
      revealInViewport(revealEls);

      if ("IntersectionObserver" in window) {
        revealObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                entry.target.classList.add("active");
                revealObserver?.unobserve(entry.target);
              }
            });
          },
          { threshold: 0.08, rootMargin: "0px" },
        );
        revealEls.forEach((el) => {
          if (!el.classList.contains("active")) {
            revealObserver?.observe(el);
          }
        });
      } else {
        revealEls.forEach((el) => el.classList.add("active"));
      }
    }

    return () => {
      document.documentElement.classList.remove("landing-motion");
      window.removeEventListener("scroll", onScroll);
      navToggle?.removeEventListener("click", onToggle);
      navLinks?.querySelectorAll("a, button").forEach((el) => {
        el.removeEventListener("click", closeMenu);
      });
      revealObserver?.disconnect();
    };
  }, []);
}
