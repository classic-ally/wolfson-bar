import { startRegistration, startAuthentication } from '@simplewebauthn/browser'

const API_BASE = window.location.origin

export interface AuthResponse {
  token: string
  user_id: string
  is_committee: boolean
  is_admin: boolean
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Register a new user with a passkey
 */
export async function registerWithPasskey(displayName: string): Promise<AuthResponse> {
  try {
    // 1. Start registration - get challenge from backend
    const startResponse = await fetch(`${API_BASE}/api/auth/register/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName }),
    })

    if (!startResponse.ok) {
      const error = await startResponse.json()
      throw new AuthError(error.error || 'Failed to start registration')
    }

    const optionsResponse = await startResponse.json()

    // 2. Create credential with browser/authenticator
    // SimpleWebAuthn v13+ expects { optionsJSON: publicKey }
    const credential = await startRegistration({
      optionsJSON: optionsResponse.publicKey || optionsResponse
    })

    // 3. Finish registration - send public key to backend
    const finishResponse = await fetch(`${API_BASE}/api/auth/register/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })

    if (!finishResponse.ok) {
      const error = await finishResponse.json()
      throw new AuthError(error.error || 'Failed to finish registration')
    }

    const authResponse: AuthResponse = await finishResponse.json()

    // Store token
    localStorage.setItem('auth_token', authResponse.token)
    localStorage.setItem('user_id', authResponse.user_id)
    localStorage.setItem('is_committee', authResponse.is_committee.toString())
    localStorage.setItem('is_admin', authResponse.is_admin.toString())

    // Reload to reflect new auth state
    window.location.reload()

    return authResponse
  } catch (error) {
    if (error instanceof AuthError) {
      throw error
    }
    throw new AuthError(error instanceof Error ? error.message : 'Registration failed')
  }
}

/**
 * Authenticate an existing user with their passkey
 */
export async function loginWithPasskey(): Promise<AuthResponse> {
  try {
    // 1. Start login - get challenge from backend
    const startResponse = await fetch(`${API_BASE}/api/auth/login/start`, {
      method: 'POST',
    })

    if (!startResponse.ok) {
      const error = await startResponse.json()
      throw new AuthError(error.error || 'Failed to start login')
    }

    const optionsResponse = await startResponse.json()

    // 2. Sign challenge with authenticator
    // SimpleWebAuthn v13+ expects { optionsJSON: publicKey }
    const credential = await startAuthentication({
      optionsJSON: optionsResponse.publicKey || optionsResponse
    })

    // 3. Finish login - verify signature
    const finishResponse = await fetch(`${API_BASE}/api/auth/login/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })

    if (!finishResponse.ok) {
      const error = await finishResponse.json()
      throw new AuthError(error.error || 'Failed to finish login')
    }

    const authResponse: AuthResponse = await finishResponse.json()

    // Store token
    localStorage.setItem('auth_token', authResponse.token)
    localStorage.setItem('user_id', authResponse.user_id)
    localStorage.setItem('is_committee', authResponse.is_committee.toString())
    localStorage.setItem('is_admin', authResponse.is_admin.toString())

    // Reload to reflect new auth state
    window.location.reload()

    return authResponse
  } catch (error) {
    if (error instanceof AuthError) {
      throw error
    }
    throw new AuthError(error instanceof Error ? error.message : 'Login failed')
  }
}

/**
 * Logout - clear stored credentials
 */
export function logout(): void {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('user_id')
  localStorage.removeItem('is_committee')
  localStorage.removeItem('is_admin')

  // Reload to reflect logged out state
  window.location.reload()
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  return localStorage.getItem('auth_token') !== null
}

/**
 * Get stored auth token
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token')
}

/**
 * Get stored user ID
 */
export function getUserId(): string | null {
  return localStorage.getItem('user_id')
}

/**
 * Check if user is committee member
 */
export function isCommittee(): boolean {
  return localStorage.getItem('is_committee') === 'true'
}

/**
 * Check if user is admin
 */
export function isAdmin(): boolean {
  return localStorage.getItem('is_admin') === 'true'
}

/**
 * Make authenticated API request
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken()

  if (!token) {
    throw new AuthError('Not authenticated')
  }

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    },
  })
}

export interface UserStatus {
  user_id: string
  display_name: string | null
  is_committee: boolean
  code_of_conduct_signed: boolean
  food_safety_completed: boolean
  has_food_safety_certificate: boolean
  induction_completed: boolean
  has_contract: boolean
  contract_expiry_date: string | null
}

/**
 * Get current user's status
 */
export async function getUserStatus(): Promise<UserStatus> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get user status')
  }

  return response.json()
}

/**
 * Accept Code of Conduct
 */
export async function acceptCodeOfConduct(): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/accept-coc`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to accept Code of Conduct')
  }
}

/**
 * Upload food safety certificate
 */
export async function uploadCertificate(file: File): Promise<void> {
  const formData = new FormData()
  formData.append('certificate', file)

  const token = getAuthToken()
  if (!token) {
    throw new AuthError('Not authenticated')
  }

  const response = await fetch(`${API_BASE}/api/users/me/food-safety-certificate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to upload certificate')
  }
}

export interface PendingCertificate {
  user_id: string
  display_name: string | null
}

export interface ActiveMember {
  user_id: string
  display_name: string | null
  has_contract: boolean
  contract_expiry_date: string | null
  is_committee: boolean
}

/**
 * Get pending food safety certificates (committee only)
 */
export async function getPendingCertificates(): Promise<PendingCertificate[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/pending-certificates`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get pending certificates')
  }

  return response.json()
}

export interface CertificateData {
  url: string
  contentType: string
}

/**
 * Get certificate URL and content type for viewing (with auth header)
 */
export async function getCertificateData(userId: string): Promise<CertificateData> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/certificate/${userId}`)

  if (!response.ok) {
    throw new AuthError('Failed to fetch certificate')
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const blob = await response.blob()
  return {
    url: URL.createObjectURL(blob),
    contentType,
  }
}

/**
 * Approve food safety certificate (committee only)
 */
export async function approveCertificate(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/approve-food-safety/${userId}`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to approve certificate')
  }
}

export interface VerificationToken {
  token: string
}

/**
 * Get verification token for QR code
 */
export async function getVerificationToken(type: 'induction' | 'food_safety'): Promise<string> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/verification-token?type=${type}`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get verification token')
  }

  const data: VerificationToken = await response.json()
  return data.token
}

/**
 * Verify induction via QR code (committee only)
 */
export async function verifyInduction(token: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/verify-induction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to verify induction')
  }
}

/**
 * Update display name
 */
export async function updateDisplayName(displayName: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/display-name`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ display_name: displayName }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to update display name')
  }
}

/**
 * Get all active members (committee only)
 */
export async function getActiveMembers(): Promise<ActiveMember[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/active-members`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get active members')
  }

  return response.json()
}

export interface PendingContract {
  user_id: string
  display_name: string | null
  contract_expiry_date: string
}

/**
 * Submit contract request with expiry date
 */
export async function submitContractRequest(expiryDate: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/contract-request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contract_expiry_date: expiryDate }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to submit contract request')
  }
}

/**
 * Get pending contract requests (committee only)
 */
export async function getPendingContracts(): Promise<PendingContract[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/pending-contracts`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get pending contracts')
  }

  return response.json()
}

/**
 * Approve a contract (committee only)
 */
export async function approveContract(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/approve-contract/${userId}`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to approve contract')
  }
}

export interface Event {
  id: string
  title: string
  description: string | null
  event_date: string
  shift_max_volunteers: number | null
  shift_requires_contract: boolean | null
}

/**
 * Get events within date range (public endpoint, no auth required)
 */
export async function getEvents(startDate?: string, endDate?: string): Promise<Event[]> {
  const params = new URLSearchParams()
  if (startDate) params.append('start_date', startDate)
  if (endDate) params.append('end_date', endDate)

  const url = `${API_BASE}/api/events${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch events')
  }

  return response.json()
}

export interface ShiftSignupUser {
  user_id: string
  display_name: string | null
  is_committee: boolean
}

export interface ShiftInfo {
  date: string
  event_title: string | null
  event_description: string | null
  max_volunteers: number
  requires_contract: boolean
  signups_count: number
  signups: ShiftSignupUser[]
}

export interface UserShift {
  date: string
  event_title: string | null
}

/**
 * Get shift information for date range (authenticated)
 */
export async function getShifts(startDate: string, endDate: string): Promise<ShiftInfo[]> {
  const params = new URLSearchParams()
  params.append('start_date', startDate)
  params.append('end_date', endDate)

  const response = await authenticatedFetch(`${API_BASE}/api/shifts?${params.toString()}`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch shifts')
  }

  return response.json()
}

/**
 * Sign up for a shift (authenticated)
 */
export async function signupForShift(date: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/signup`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to sign up for shift')
  }
}

/**
 * Cancel shift signup (authenticated)
 */
export async function cancelShiftSignup(date: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/signup`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to cancel signup')
  }
}

/**
 * Get current user's upcoming shifts (authenticated)
 */
export async function getMyShifts(): Promise<UserShift[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/shifts`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch your shifts')
  }

  return response.json()
}

export interface BarHours {
  day_of_week: number  // 0=Sunday, 1=Monday, ..., 6=Saturday
  open_time: string
  close_time: string
}

/**
 * Get bar hours (committee only)
 */
export async function getBarHours(): Promise<BarHours[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/bar-hours`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch bar hours')
  }

  return response.json()
}

/**
 * Update bar hours for a specific day (committee only)
 */
export async function updateBarHours(dayOfWeek: number, openTime: string, closeTime: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/bar-hours`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      day_of_week: dayOfWeek,
      open_time: openTime,
      close_time: closeTime,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to update bar hours')
  }
}

export interface OverviewStats {
  active_members_count: number
  pending_certificates_count: number
  pending_contracts_count: number
  unstaffed_shifts_next_3_days: number
  understaffed_events_next_7_days: number
  expiring_contracts_next_30_days: number
}

/**
 * Get overview statistics for committee dashboard
 */
export async function getOverviewStats(): Promise<OverviewStats> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/overview`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch overview stats')
  }

  return response.json()
}

export interface UserOverview {
  next_onboarding_step: string | null
  shifts_next_7_days: number
  contract_expiry_date: string | null
}

/**
 * Get user overview for dashboard
 */
export async function getMyOverview(): Promise<UserOverview> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/overview`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch user overview')
  }

  return response.json()
}

// ===== Stock Management =====

export interface Product {
  id: number
  name: string
  description: string | null
  category: string
  current_stock: number
  last_unit_cost: number | null
  created_at: string
  updated_at: string
}

export interface CreateProductRequest {
  name: string
  description?: string
  category: string
}

/**
 * Get all products with stock levels (committee only)
 */
export async function getProducts(): Promise<Product[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/products`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch products')
  }

  return response.json()
}

/**
 * Create a new product with specified PoS ID (committee only)
 */
export async function createProduct(id: number, product: CreateProductRequest): Promise<Product> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/products/${id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(product),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to create product')
  }

  return response.json()
}

/**
 * Look up product by barcode (committee only)
 * Returns product with current stock information
 */
export async function lookupBarcode(barcode: string): Promise<Product> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/barcode/${barcode}`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Barcode not found')
  }

  return response.json()
}

/**
 * Link a barcode to a product (committee only)
 */
export async function addBarcode(productId: number, barcode: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/products/${productId}/barcodes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ barcode }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to add barcode')
  }
}

export interface StockTransaction {
  product_id: number
  quantity: number  // Positive = add stock, Negative = remove stock
  unit_cost?: number  // Required for positive quantities (purchases), unless it's an adjustment
}

export interface CreateTransactionsRequest {
  transactions: StockTransaction[]
  notes?: string
}

/**
 * Create stock transactions (committee only)
 */
export async function createStockTransactions(request: CreateTransactionsRequest): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to create transactions')
  }
}

// ===== Admin User Management (admin only) =====

export interface UserListItem {
  id: string
  display_name: string | null
  is_committee: boolean
  is_admin: boolean
  created_at: string
}

/**
 * Get all users (admin only)
 */
export async function getAllUsers(): Promise<UserListItem[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch users')
  }

  return response.json()
}

/**
 * Promote a user (admin only)
 * user -> committee -> admin
 */
export async function promoteUser(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/promote`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to promote user')
  }
}

/**
 * Demote a user (admin only)
 * admin -> committee -> user
 */
export async function demoteUser(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/demote`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to demote user')
  }
}

/**
 * Delete a user (admin only)
 */
export async function deleteUser(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to delete user')
  }
}
