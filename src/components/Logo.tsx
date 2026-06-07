import React from 'react';

export function FLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 60 60" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="flogo-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000000" floodOpacity="0.4" />
        </filter>
      </defs>
      
      {/* Top Pill */}
      <g filter="url(#flogo-shadow)">
        {/* Right part: Teal */}
        <path d="M12 4 H 48 A 10 10 0 0 1 58 14 A 10 10 0 0 1 48 24 H 12 Z" fill="#3bc5c3" />
        {/* Left part: Blue */}
        <path d="M12 4 A 10 10 0 0 0 2 14 A 10 10 0 0 0 12 24 Z" fill="#2f52a8" />
      </g>
      
      {/* Middle Pill */}
      <g filter="url(#flogo-shadow)">
        {/* Right part: Orange */}
        <path d="M12 22 H 48 A 10 10 0 0 1 58 32 A 10 10 0 0 1 48 42 H 12 Z" fill="#f07f28" />
        {/* Left part: Teal */}
        <path d="M12 22 A 10 10 0 0 0 2 32 A 10 10 0 0 0 12 42 Z" fill="#3bc5c3" />
      </g>

      {/* Bottom Circle/Half-Pill */}
      <g filter="url(#flogo-shadow)">
        {/* Right part: Red */}
        <path d="M12 40 A 10 10 0 0 1 22 50 A 10 10 0 0 1 12 60 Z" fill="#bd2233" />
        {/* Left part: Yellow */}
        <path d="M12 40 A 10 10 0 0 0 2 50 A 10 10 0 0 0 12 60 Z" fill="#f39f35" />
      </g>
    </svg>
  );
}
