// Guesty Open API surface — read-only types for analytics + AI message review.
// We are NOT a PMS; Guesty stays system of record.

export interface CustomFieldValue {
  fieldId: string
  fieldName: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect' | 'phone' | 'url' | 'file'
  value: string | number | boolean | string[] | null
}

export interface CustomFieldDefinition {
  id: string
  name: string
  type: CustomFieldValue['type']
  target: 'reservation' | 'listing' | 'guest'
  options?: string[]      // for select / multiselect
  required?: boolean
}

export interface Reservation {
  id: string
  listingId: string
  listingName: string
  guest: { id?: string; name: string; email?: string; phone?: string }
  checkIn: string
  checkOut: string
  status: 'inquiry' | 'reserved' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
  nights: number
  money: { totalPaid: number; balanceDue: number; currency: string }
  source: 'airbnb' | 'vrbo' | 'booking' | 'direct' | 'other'
  confirmationCode?: string
  notes?: string
  createdAt: string
  customFields?: CustomFieldValue[]   // verifications, welcome call, sensitive guest, etc.
  conversationId?: string             // FK to thread
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

export interface Conversation {
  id: string
  reservationId?: string
  listingId?: string
  guestName: string
  channel: 'airbnb' | 'vrbo' | 'booking' | 'sms' | 'email' | 'whatsapp' | 'other'
  lastMessageAt: string
  lastMessagePreview: string
  unreadCount: number
}

export interface Message {
  id: string
  conversationId: string
  sender: 'guest' | 'host' | 'system' | 'ai'
  senderName: string
  body: string
  sentAt: string
  attachments?: { url: string; kind: 'image' | 'file' }[]
}
