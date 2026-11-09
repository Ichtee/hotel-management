const DAY = 864e5;
const iso = (d) => (typeof d === "string" ? d : new Date(d).toISOString()).slice(0, 10);
const midnight = (d) => Date.parse(`${iso(d)}T00:00:00Z`);

// BR-07: the price rate of that date, or the base price of the room type.
function priceAt(type, date) {
  const d = new Date(midnight(date));
  return (type.seasonalPricing || []).find((p) => d >= p.startDate && d <= p.endDate)?.price || type.basePrice;
}
const nightsOf = (from, to) => Math.round((midnight(to) - midnight(from)) / DAY);

// SDS b.10 nightlyRates: one { date, roomTypeId, price } per night of [from, to), at the rate of that night (BR-07, BR-34).
// `kept` = nights the booking already has: they keep their snapshot price and room type (BR-35, BR-38).
function priceNights(type, from, to, kept = []) {
  const byDay = new Map(kept.map((n) => [iso(n.date), n]));
  const nights = [];
  for (let t = midnight(from), end = midnight(to); t < end; t += DAY) {
    const old = byDay.get(iso(new Date(t)));
    nights.push(old ? { date: old.date, roomTypeId: old.roomTypeId, price: old.price } : { date: new Date(t), roomTypeId: type._id, price: priceAt(type, new Date(t)) });
  }
  return nights;
}
const sumNights = (nights) => nights.reduce((sum, n) => sum + n.price, 0);
const stayAmount = (type, from, to) => sumNights(priceNights(type, from, to));
// The stored nights of a booking; one made before the snapshot existed has every night at its stored nightly price.
function storedNights(booking) {
  if (booking.nightlyRates?.length) return booking.nightlyRates.map(({ date, roomTypeId, price }) => ({ date, roomTypeId, price }));
  const line = booking.rooms[0];
  return priceNights({ _id: line.roomTypeId, basePrice: line.priceAtBooking }, booking.checkInDate, booking.checkOutDate);
}
// CR-20: whole VND, 0.5 rounds up.
const percentOf = (amount, percent) => Math.round((amount * percent) / 100);

module.exports = { DAY, iso, priceAt, nightsOf, priceNights, sumNights, stayAmount, storedNights, percentOf };
