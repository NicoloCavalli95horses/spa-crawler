"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./ResourceButton.module.css";

interface ResourceButtonProps {
  id: string;
  premium: boolean;
}

export default function ResourceButton({
  id,
  premium,
}: ResourceButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      {premium ? (
        <button
          className={styles.premiumButton}
          onClick={() => setIsModalOpen(true)}
        >
          Premium resource
        </button>
      ) : (
        <Link href={`/detail/${encodeURIComponent(id)}`}>
          <button className={styles.freeButton}>
            Free resource
          </button>
        </Link>
      )}

      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h2>Premium resource</h2>
            <p>This resource requires a premium subscription.</p>

            <button onClick={() => setIsModalOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}