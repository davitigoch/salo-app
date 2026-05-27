import React, { createContext, useContext } from 'react';

const ClientsContext = createContext(null);

export function ClientsProvider({ value, children }) {
  return <ClientsContext.Provider value={value}>{children}</ClientsContext.Provider>;
}

export function useClients() {
  const context = useContext(ClientsContext);
  if (!context) {
    throw new Error('useClients must be used within a ClientsProvider');
  }
  return context;
}
