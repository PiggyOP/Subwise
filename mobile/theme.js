import React, { createContext, useContext, useEffect, useState } from "react";
import { Appearance, Pressable, Text } from "react-native";
import * as SecureStore from "expo-secure-store";
const ThemeContext = createContext(null);
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() =>
    Appearance.getColorScheme() === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync("subwise.theme")
      .then((saved) => {
        if (mounted && (saved === "light" || saved === "dark")) setTheme(saved);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    SecureStore.setItemAsync("subwise.theme", next).catch(() => {});
  };
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
export function ThemeToggle() {
  const { theme, toggle } = useTheme(),
    dark = theme === "dark";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}
      onPress={toggle}
      style={({ pressed }) => ({
        paddingHorizontal: 11,
        paddingVertical: 9,
        borderWidth: 1,
        borderColor: dark ? "#3b4f43" : "#dfe4df",
        borderRadius: 5,
        backgroundColor: dark ? "#22352a" : "#fff",
        opacity: pressed ? 0.65 : 1,
        alignSelf: "flex-end",
      })}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "500",
          color: dark ? "#d6e2d7" : "#58704e",
        }}
      >
        {dark ? "☼  Light" : "☾  Dark"}
      </Text>
    </Pressable>
  );
}
