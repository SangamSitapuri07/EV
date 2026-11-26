import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { connectors, platformSettings, pricingRules, type spaceCategoryEnum } from "@/db/schema";
import { AppError } from "@/lib/api-response";

export const priceEstimateInputSchema = z.object({
  facilityId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  spaceCategory: z
    .enum([
      "STANDARD",
      "COMPACT",
      "SUV",
      "TWO_WHEELER",
      "ACCESSIBLE",
      "EV_COMPATIBLE",
      "VIP_RESERVED",
    ])
    .optional(),
  connectorId: z.string().uuid().optional().nullable(),
  estimatedKwh: z.number().min(0).max(200).optional().default(0),
  promoCode: z.string().trim().max(32).optional(),
});

export type PriceEstimateInput = z.infer<typeof priceEstimateInputSchema>;

export interface PriceBreakdown {
  currency: string;
  durationMinutes: number;
  billableMinutes: number;
  ruleId: string;
  ruleName: string;
  hourlyRatePaise: number;
  isPeakApplied: boolean;
  isWeekendApplied: boolean;
  isDailyCapApplied: boolean;
  parkingBasePaise: number;
  chargingEnergyPaise: number;
  chargingSessionFeePaise: number;
  chargingEstimatePaise: number;
  discountPaise: number;
  subtotalPaise: number;
  platformFeeBps: number;
  platformFeePaise: number;
  taxBps: number;
  taxPaise: number;
  totalEstimatedPaise: number;
}

const PROMO_DISCOUNTS_BPS: Record<string, number> = {
  EVFIRST10: 1000, // 10% off subtotal
  CLEAN20: 2000, // 20% off subtotal
};

export async function calculatePriceEstimate(
  input: PriceEstimateInput
): Promise<PriceBreakdown> {
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new AppError(400, "INVALID_WINDOW", "End time must be after start time");
  }

  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
  const { db } = await ensureDatabaseReady();

  // Fetch active pricing rules for facility, sorted by priority desc
  const rules = await db
    .select()
    .from(pricingRules)
    .where(and(eq(pricingRules.facilityId, input.facilityId), eq(pricingRules.isActive, true)))
    .orderBy(desc(pricingRules.priority));

  const matchedRule =
    rules.find((r) => input.spaceCategory && r.spaceCategory === input.spaceCategory) ??
    rules.find((r) => r.spaceCategory === null) ??
    rules[0];

  if (!matchedRule) {
    throw new AppError(404, "PRICING_NOT_CONFIGURED", "No active pricing rule for this facility");
  }

  const [policySetting] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "pricing_policy"))
    .limit(1);

  const platformFeeBps = Number(
    (policySetting?.value as { platformFeeBps?: number } | undefined)?.platformFeeBps ??
      process.env.PLATFORM_FEE_BPS ??
      500
  );

  // Billable minutes respect minimum billable duration
  const billableMinutes = Math.max(durationMinutes, matchedRule.minBillableMinutes);

  // Peak & weekend checks (evaluated in UTC+5:30 IST for local Indian city accuracy or UTC)
  const localStartHour = (start.getUTCHours() + 5 + Math.floor((start.getUTCMinutes() + 30) / 60)) % 24;
  const day = start.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const isPeak =
    localStartHour >= matchedRule.peakStartHour && localStartHour < matchedRule.peakEndHour;

  // Compute integer paise parking charge
  let effectiveHourlyPaise = matchedRule.hourlyRatePaise;
  if (isPeak && matchedRule.peakMultiplierBps !== 10000) {
    effectiveHourlyPaise = Math.round((effectiveHourlyPaise * matchedRule.peakMultiplierBps) / 10000);
  }
  if (isWeekend && matchedRule.weekendMultiplierBps !== 10000) {
    effectiveHourlyPaise = Math.round(
      (effectiveHourlyPaise * matchedRule.weekendMultiplierBps) / 10000
    );
  }

  // Raw proportional amount rounded to integer paise
  const rawParkingPaise = Math.round((effectiveHourlyPaise * billableMinutes) / 60);

  // Apply daily cap per 24h block
  const days = Math.max(1, Math.ceil(billableMinutes / (24 * 60)));
  const maxForWindowPaise = matchedRule.dailyMaxPaise * days;
  const isDailyCapApplied = rawParkingPaise > maxForWindowPaise;
  const parkingBasePaise = Math.min(rawParkingPaise, maxForWindowPaise);

  // EV Charging estimate if connector selected
  let chargingEnergyPaise = 0;
  let chargingSessionFeePaise = 0;
  if (input.connectorId) {
    const [connector] = await db
      .select()
      .from(connectors)
      .where(
        and(eq(connectors.id, input.connectorId), eq(connectors.facilityId, input.facilityId))
      )
      .limit(1);

    if (!connector) {
      throw new AppError(404, "CONNECTOR_NOT_FOUND", "Selected EV connector not found at facility");
    }

    const kwh = input.estimatedKwh > 0 ? input.estimatedKwh : 10; // default 10 kWh estimate if selected
    chargingEnergyPaise = Math.round(kwh * connector.pricePerKwhPaise);
    chargingSessionFeePaise = connector.sessionFeePaise;
  }

  const chargingEstimatePaise = chargingEnergyPaise + chargingSessionFeePaise;
  const grossSubtotal = parkingBasePaise + chargingEstimatePaise;

  const promoKey = input.promoCode?.toUpperCase().trim() ?? "";
  const discountBps = PROMO_DISCOUNTS_BPS[promoKey] ?? 0;
  const discountPaise = discountBps > 0 ? Math.round((grossSubtotal * discountBps) / 10000) : 0;

  const subtotalPaise = Math.max(0, grossSubtotal - discountPaise);
  const platformFeePaise = Math.round((subtotalPaise * platformFeeBps) / 10000);
  const taxableBase = subtotalPaise + platformFeePaise;
  const taxPaise = Math.round((taxableBase * matchedRule.taxBps) / 10000);
  const totalEstimatedPaise = taxableBase + taxPaise;

  return {
    currency: matchedRule.currency,
    durationMinutes,
    billableMinutes,
    ruleId: matchedRule.id,
    ruleName: matchedRule.name,
    hourlyRatePaise: matchedRule.hourlyRatePaise,
    isPeakApplied: isPeak && matchedRule.peakMultiplierBps !== 10000,
    isWeekendApplied: isWeekend && matchedRule.weekendMultiplierBps !== 10000,
    isDailyCapApplied,
    parkingBasePaise,
    chargingEnergyPaise,
    chargingSessionFeePaise,
    chargingEstimatePaise,
    discountPaise,
    subtotalPaise,
    platformFeeBps,
    platformFeePaise,
    taxBps: matchedRule.taxBps,
    taxPaise,
    totalEstimatedPaise,
  };
}

export function computeCancellationRefundPaise(params: {
  paidAmountPaise: number;
  startTime: Date;
  cancelledAt: Date;
  operatorFault?: boolean;
}): { refundPaise: number; refundRatioPct: number; policyNote: string } {
  if (params.paidAmountPaise <= 0) {
    return { refundPaise: 0, refundRatioPct: 0, policyNote: "No captured payment to refund." };
  }
  if (params.operatorFault) {
    return {
      refundPaise: params.paidAmountPaise,
      refundRatioPct: 100,
      policyNote: "100% refund due to operator/charger unavailability.",
    };
  }
  const minutesBeforeStart = (params.startTime.getTime() - params.cancelledAt.getTime()) / 60_000;
  if (minutesBeforeStart >= 30) {
    return {
      refundPaise: params.paidAmountPaise,
      refundRatioPct: 100,
      policyNote: "100% refund (cancelled 30+ minutes before arrival).",
    };
  }
  if (minutesBeforeStart > 0) {
    return {
      refundPaise: Math.round(params.paidAmountPaise * 0.5),
      refundRatioPct: 50,
      policyNote: "50% refund (cancelled within 30 minutes of arrival).",
    };
  }
  return {
    refundPaise: 0,
    refundRatioPct: 0,
    policyNote: "No refund after reservation start time.",
  };
}

export type SpaceCategoryType = (typeof spaceCategoryEnum.enumValues)[number];
