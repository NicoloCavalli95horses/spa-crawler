"use client";

import { useState } from "react";
import styles from "./ResourceButton.module.css";

interface QueryParamResourceButtonProps {
  id: string;
  premium: boolean;
  onSelect: (id: string) => void;
}

export default function QueryParamResourceButton({
  id,
  premium,
  onSelect,
}: QueryParamResourceButtonProps) {
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
        <button className={styles.freeButton} onClick={() => onSelect(id)}>
          Free resource
        </button>
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
