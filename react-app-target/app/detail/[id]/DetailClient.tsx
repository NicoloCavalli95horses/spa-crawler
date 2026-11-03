"use client";

import { useEffect, useState } from "react";

interface Detail {
  id: string;
  premium: boolean;
  data: string;
}

export default function DetailClient({ id }: { id: string }) {
  const [resource, setResource] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/detail/${encodeURIComponent(id)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        return response.json() as Promise<Detail>;
      })
      .then(setResource)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p>Resource not found</p>;
  }

  if (!resource) {
    return <p>Loading...</p>;
  }

  return (
    <main>
      <h1>Resource detail</h1>
      <p>ID: {resource.id}</p>
      <p>Premium: {resource.premium ? "Yes" : "No"}</p>
      <p>{resource.data}</p>
    </main>
  );
}
