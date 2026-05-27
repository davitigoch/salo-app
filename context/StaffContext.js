import React, { createContext, useContext } from 'react';

const StaffContext = createContext(null);

export function StaffProvider({ value, children }) {
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function useStaff() {
  const context = useContext(StaffContext);
  if (!context) {
    throw new Error('useStaff must be used within a StaffProvider');
  }
  return context;
}
