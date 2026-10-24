import { useEffect, useState } from "react";

// `value`, once it has stopped changing for `delay` ms. Used for search boxes,
// so the server is asked once per pause in typing, not once per keystroke.
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
