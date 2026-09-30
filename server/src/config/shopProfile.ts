/**
 * Shop profile shown in the app. A plain configuration, deliberately separate from Product, Sale,
 * Purchase and Expense: nothing here feeds any shop calculation.
 *
 * The phone number is not stored here: it is the mobile number the owner gave when creating the account.
 * Only the name comes from the project; the description is a generic placeholder and the location is
 * empty because the project has no address. Edit this file to add the shop's real details.
 */
export const SHOP_PROFILE = {
  name: 'Sharma Grocery Store',
  description: 'A neighbourhood grocery store for everyday food and household items.',
  descriptionIsPlaceholder: true,
  location: null as string | null,
}
