"use client";

import { useEffect, useState } from "react";
import ResourceButton from "./components/ResourceButton";
import QueryParamResourceButton from "./components/QueryParamResourceButton";

interface Idata {
  id: string;
  premium: boolean;
}

interface Detail extends Idata {
  data: string;
}

function readResourceId(): string | null {
  return new URLSearchParams(window.location.search).get("resourceId");
}

export default function App() {
  const [data, setData] = useState<Idata[] | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        return response.json() as Promise<Idata[]>;
      })
      .then(setData)
      .catch(console.error);
  }, []);

  useEffect(() => {
    setResourceId(readResourceId());
    const onPopState = () => setResourceId(readResourceId());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!resourceId) {
      setDetail(null);
      return;
    }

    // Bug: whatever id ends up in the "resourceId" query parameter gets rendered straight from the
    // (unauthenticated) detail endpoint. selectQueryParamResource() below checks /api/preview before
    // ever setting that parameter on a real click, but this effect reacts to the URL itself, however
    // it got there — a crafted query string bypasses the premium check entirely.
    fetch(`/api/detail/${encodeURIComponent(resourceId)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        return response.json() as Promise<Detail>;
      })
      .then(setDetail)
      .catch(console.error);
  }, [resourceId]);

  const selectQueryParamResource = (id: string) => {
    fetch(`/api/preview?resourceId=${encodeURIComponent(id)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        const url = new URL(window.location.href);
        url.searchParams.set("resourceId", id);
        window.history.pushState({}, "", url);
        window.dispatchEvent(new Event("popstate"));
      })
      .catch(console.error);
  };

  if (!data) {
    return <p>Loading...</p>;
  }

  return (
    <>
      <h2>Server-side resources (path parameter)</h2>
      {data.map((object) => (
        <ResourceButton
          key={object.id}
          id={object.id}
          premium={object.premium}
        />
      ))}

      <h2>Client-side resources (query parameter)</h2>
      {data.map((object) => (
        <QueryParamResourceButton
          key={object.id}
          id={object.id}
          premium={object.premium}
          onSelect={selectQueryParamResource}
        />
      ))}

      {detail && (
        // Keyed by id so React remounts the whole section on every switch, instead of patching
        // text in place — matters for RAPIDOR's own client-side-routing probe, which only watches
        // for element insertion/removal/attribute changes, not plain text-content mutations.
        <section key={detail.id}>
          <h3>Selected resource</h3>
          <p>ID: {detail.id}</p>
          <p>Premium: {detail.premium ? "Yes" : "No"}</p>
          <p>{detail.data}</p>
        </section>
      )}
    </>
  );
}
