// Tailwind v3 on purpose: v4 needs Safari 16.4+, and the wall iPad runs iOS 12 (Safari 12.1).
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  // The default `:is(.dark *)` selector needs Safari 14; plain selectors work on Safari 12.
  darkMode: ['variant', ['.dark &', '&.dark']],
  // These generate CSS Safari 12 can't use (flexbox `gap`, `:where()`), so they're turned off.
  // Use margins on children instead.
  corePlugins: {
    gap: false,
    space: false,
    divideWidth: false,
    divideColor: false,
    divideOpacity: false,
    divideStyle: false,
  },
  theme: {
    extend: {
      // The dashboard scales with the screen height, so sizes are in vh.
      fontSize: {
        clock: ['22vh', '1'],
        // Fits "HH:mm" in half the width of an iPad held landscape.
        'clock-half': ['18vh', '1'],
        countdown: ['18vh', '1'],
        wheel: ['8vh', '10vh'],
        'vh-6': '6vh',
        'vh-5': '5vh',
        'vh-4': '4vh',
        'vh-3.5': '3.5vh',
        'vh-3': '3vh',
        'vh-2.5': '2.5vh',
      },
      keyframes: {
        flash: { to: { visibility: 'hidden' } },
      },
      animation: {
        flash: 'flash 1s steps(2, start) infinite',
      },
    },
  },
};
