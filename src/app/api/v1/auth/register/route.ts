import { z } from "zod";
import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { evOwnerVerifications, operators, userProfiles, users } from "@/db/schema";
import { AppError, created, handleApiError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import {
  generateOpaqueToken,
  hashPassword,
  SESSION_COOKIE_NAME,
  signSessionToken,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/utils";

export const evOwnerVerificationSchema = z.object({
  // 1. Owner verification
  ownerName: z.string().trim().min(2).max(160),
  businessType: z.enum([
    "INDIVIDUAL",
    "PROPRIETORSHIP",
    "PARTNERSHIP",
    "LLP",
    "PRIVATE_LIMITED",
  ]),
  panNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Valid 10-character PAN required (e.g. ABCDE1234F)"),
  gstinNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid 15-character GSTIN")
    .optional()
    .or(z.literal("")),
  businessDocName: z.string().trim().min(2).max(255),
  businessDocRef: z.string().trim().min(3).max(2000),

  // 2. Location & ownership proof
  siteAddress: z.string().trim().min(5).max(500),
  siteCity: z.string().trim().min(2).max(120),
  ownershipType: z.enum(["OWNED", "LEASED", "AUTHORIZED"]),
  propertyDocName: z.string().trim().min(2).max(255),
  propertyDocRef: z.string().trim().min(3).max(2000),
  nocDocName: z.string().trim().min(2).max(255),
  nocDocRef: z.string().trim().min(3).max(2000),
  electricityBoard: z.string().trim().min(2).max(160),
  electricityConsumerNo: z.string().trim().min(4).max(80),
  sanctionedLoadKw: z.coerce.number().min(3).max(2000),

  // 3. Charger verification
  chargerManufacturer: z.string().trim().min(2).max(120),
  chargerModel: z.string().trim().min(1).max(120),
  chargerSerialNumber: z.string().trim().min(3).max(120),
  connectorType: z.enum([
    "CCS2",
    "TYPE2_AC",
    "CHADEMO",
    "BHARAT_DC001",
    "BHARAT_AC001",
    "GB_T",
  ]),
  complianceStandard: z.string().trim().min(2).max(160),
  chargerDocName: z.string().trim().min(2).max(255),
  chargerDocRef: z.string().trim().min(3).max(2000),
});

const registerSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(7).max(32).optional(),
  role: z.enum(["CUSTOMER", "PARKING_OPERATOR", "EV_OPERATOR"]).default("CUSTOMER"),
  businessName: z.string().trim().min(2).max(180).optional(),
  registrationNumber: z.string().trim().min(3).max(100).optional(),
  ownerVerification: evOwnerVerificationSchema.optional(),
});

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const rl = checkRateLimit(`register:${ip}`, 20, 60_000);
    if (!rl.allowed) {
      throw new AppError(429, "RATE_LIMITED", "Too many registration attempts");
    }

    const body = registerSchema.parse(await req.json());
    if (
      (body.role === "EV_OPERATOR" || body.role === "PARKING_OPERATOR") &&
      !body.ownerVerification
    ) {
      throw new AppError(
        400,
        "OWNER_VERIFICATION_REQUIRED",
        "EV Pump & Facility Owners must complete Owner Verification, Location/Ownership Proof, and Charger Verification."
      );
    }

    const { db } = await ensureDatabaseReady();

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    if (existing) {
      throw new AppError(409, "EMAIL_EXISTS", "An account with this email already exists");
    }

    const passwordHash = await hashPassword(body.password);
    const verificationToken = generateOpaqueToken();

    const createdUser = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: body.email,
          passwordHash,
          fullName: body.fullName,
          phone: body.phone ?? null,
          role: body.role,
          emailVerified: false,
          verificationToken,
        })
        .returning();

      if (!u) throw new AppError(500, "USER_CREATE_FAILED", "Could not register user");

      await tx.insert(userProfiles).values({
        userId: u.id,
        preferredCity: body.ownerVerification?.siteCity || "Ludhiana",
      });

      if (body.role === "PARKING_OPERATOR" || body.role === "EV_OPERATOR") {
        const verif = body.ownerVerification!;
        const [op] = await tx
          .insert(operators)
          .values({
            ownerUserId: u.id,
            businessName: body.businessName || `${verif.ownerName} EV Mobility`,
            registrationNumber: body.registrationNumber || verif.panNumber,
            gstNumber: verif.gstinNumber || null,
            operatorType: body.role === "EV_OPERATOR" ? "EV_CHARGING" : "PARKING",
            contactEmail: body.email,
            contactPhone: body.phone || "+91-98000-00000",
            status: "PENDING_VERIFICATION",
          })
          .returning();

        if (op) {
          await tx.insert(evOwnerVerifications).values({
            operatorId: op.id,
            userId: u.id,
            ownerName: verif.ownerName,
            businessType: verif.businessType,
            panNumber: verif.panNumber,
            gstinNumber: verif.gstinNumber || null,
            businessDocName: verif.businessDocName,
            businessDocRef: verif.businessDocRef,
            siteAddress: verif.siteAddress,
            siteCity: verif.siteCity,
            ownershipType: verif.ownershipType,
            propertyDocName: verif.propertyDocName,
            propertyDocRef: verif.propertyDocRef,
            nocDocName: verif.nocDocName,
            nocDocRef: verif.nocDocRef,
            electricityBoard: verif.electricityBoard,
            electricityConsumerNo: verif.electricityConsumerNo,
            sanctionedLoadKw: verif.sanctionedLoadKw,
            chargerManufacturer: verif.chargerManufacturer,
            chargerModel: verif.chargerModel,
            chargerSerialNumber: verif.chargerSerialNumber,
            connectorType: verif.connectorType,
            complianceStandard: verif.complianceStandard,
            chargerDocName: verif.chargerDocName,
            chargerDocRef: verif.chargerDocRef,
            verificationStatus: "PENDING",
          });
        }
      }

      return u;
    });

    const sessionUser = {
      id: createdUser.id,
      email: createdUser.email,
      fullName: createdUser.fullName,
      role: createdUser.role,
      emailVerified: createdUser.emailVerified,
    };

    const token = await signSessionToken(sessionUser);

    await writeAuditLog({
      actorUserId: createdUser.id,
      actorRole: createdUser.role,
      action: "USER_REGISTERED",
      entityType: "USER",
      entityId: createdUser.id,
      afterState: {
        email: createdUser.email,
        role: createdUser.role,
        ownerVerificationSubmitted: Boolean(body.ownerVerification),
      },
      ipAddress: ip,
    });

    const res = created({
      user: sessionUser,
      verificationPreviewToken:
        process.env.NODE_ENV !== "production" ? verificationToken : undefined,
    });

    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
