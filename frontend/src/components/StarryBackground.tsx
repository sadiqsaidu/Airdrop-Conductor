import React, { useState, useEffect } from 'react';

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  delay: number;
}

const StarryBackground: React.FC = () => {
  const [stars, setStars] = useState<Star[]>([]);
  const [transform, setTransform] = useState('translate(0px, 0px)');

  useEffect(() => {
    const generateStars = () => {
      const newStars: Star[] = [];
      for (let i = 0; i < 150; i++) {
        newStars.push({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.5 + 0.3,
          delay: Math.random() * 3
        });
      }
      setStars(newStars);
    };
    generateStars();
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      const { innerWidth, innerHeight } = window;
      const dx = (clientX - innerWidth / 2) / (innerWidth / 2) * -15;
      const dy = (clientY - innerHeight / 2) / (innerHeight / 2) * -15;
      setTransform(`translate(${dx}px, ${dy}px)`);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div 
      className="fixed inset-0 pointer-events-none overflow-hidden z-0 transition-transform duration-300 ease-out"
      style={{ transform }}
    >
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full bg-white"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: star.opacity,
            animation: `twinkle ${2 + star.delay}s ease-in-out infinite`,
            animationDelay: `${star.delay}s`
          }}
        />
      ))}
    </div>
  );
};

export default StarryBackground;