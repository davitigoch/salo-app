import React, { createContext, useContext } from 'react';

const BookingsContext = createContext(null);

export function BookingsProvider({ value, children }) {
  return (
    <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>
  );
}

export function useBookings() {
  const context = useContext(BookingsContext);
  if (!context) {
    throw new Error('useBookings must be used within a BookingsProvider');
  }
  return context;
}
