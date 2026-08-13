export type MockStore = {
  id: string;
  name: string;
  location: string;
  paused: boolean;
};

export const INITIAL_STORES: MockStore[] = [
  {
    id: 'store-1',
    name: 'Green Basket Market',
    location: 'Ngong Road, Nairobi',
    paused: false,
  },
  {
    id: 'store-2',
    name: 'Spice Corner Kitchen',
    location: 'Kilimani, Nairobi',
    paused: false,
  },
  {
    id: 'store-3',
    name: 'Daily Fresh Foods',
    location: 'Westlands, Nairobi',
    paused: true,
  },
];
