export interface Reservation {
  id: string
  listingId: string
  listingName: string
  guest: { name: string; email?: string; phone?: string }
  checkIn: string
  checkOut: string
  status: 'inquiry' | 'reserved' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
  nights: number
  money: { totalPaid: number; balanceDue: number; currency: string }
  source: 'airbnb' | 'vrbo' | 'booking' | 'direct' | 'other'
  notes?: string
  createdAt: string
}
export interface Listing {
  id: string
  title: string
  nickname: string
  address: { full: string; city: string; state: string }
  bedrooms: number; bathrooms: number; beds: number; maxOccupancy: number
  status: 'active' | 'inactive'
  pictures: string[]; amenities: string[]
}
