import React, { createContext, useContext } from 'react';

const ServicesContext = createContext(null);

export function ServicesProvider({ value, children }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices() {
  const context = useContext(ServicesContext);
  if (!context) {
    throw new Error('useServices must be used within a ServicesProvider');
  }
  return context;
}
