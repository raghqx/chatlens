"use client";

import type { NamedCount } from "@/lib/types";

type WordCloudProps = {
  words: NamedCount[];
};

export function WordCloud({ words }: WordCloudProps) {
  if (words.length === 0) {
    return <p className="muted">Not enough text for a word cloud.</p>;
  }

  const max = words[0]?.count || 1;

  return (
    <div className="word-cloud" aria-label="Word cloud">
      {words.map((word, index) => {
        const weight = word.count / max;
        const size = 0.85 + weight * 1.8;
        const opacity = 0.45 + weight * 0.55;
        const rotate = index % 5 === 0 ? -8 : index % 4 === 0 ? 8 : 0;

        return (
          <span
            key={`${word.name}-${index}`}
            className="word-cloud__item"
            style={{
              fontSize: `${size}rem`,
              opacity,
              transform: `rotate(${rotate}deg)`,
              animationDelay: `${index * 18}ms`,
            }}
            title={`${word.name}: ${word.count}`}
          >
            {word.name}
          </span>
        );
      })}
    </div>
  );
}
