module.exports = {
  content: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  safelist: [
    // Sidebar dynamic width
    'w-14', 'w-56',
    // Mobile sidebar translate
    'translate-x-0', '-translate-x-full',
    'sm:translate-x-0',
    // Layout critical
    'h-screen', 'overflow-hidden', 'flex-shrink-0',
  ],
  theme: { extend: {} },
  plugins: [],
}
