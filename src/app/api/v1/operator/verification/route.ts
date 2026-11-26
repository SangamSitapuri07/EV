import { eq } from "drizzle-orm";
import { ensureDatabaseReady } from "@/db";
import { evOwnerVerifications, operators } from "@/db/schema";
import { AppError, handleApiError, ok } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { evOwnerVerificationSchema } from "@/app/api/v1/auth/register/route";

export async function GET(req: Request) {
  try {
    const user = await requireRole(
      ["EV_OPERATOR", "PARKING_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const { db } = await ensureDatabaseReady();

    const [operator] = await db
      .select()
      .from(operators)
      .where(eq(operators.ownerUserId, user.id))
      .limit(1);

    if (!operator) {
      return ok({ operator: null, verification: null });
    }

    const [verification] = await db
      .select()
      .from(evOwnerVerifications)
      .where(eq(evOwnerVerifications.operatorId, operator.id))
      .limit(1);

    return ok({ operator, verification: verification ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireRole(
      ["EV_OPERATOR", "PARKING_OPERATOR", "SUPER_ADMIN"],
      req
    );
    const body = evOwnerVerificationSchema.parse(await req.json());
    const { db } = await ensureDatabaseReady();

    let [operator] = await db
      .select()
      .from(operators)
      .where(eq(operators.ownerUserId, user.id))
      .limit(1);

    if (!operator) {
      const [createdOp] = await db
        .insert(operators)
        .values({
          ownerUserId: user.id,
          businessName: `${body.ownerName} EV Mobility`,
          registrationNumber: body.panNumber,
          gstNumber: body.gstinNumber || null,
          operatorType: user.role === "EV_OPERATOR" ? "EV_CHARGING" : "PARKING",
          contactEmail: user.email,
          contactPhone: "+91-98000-00000",
          status: "PENDING_VERIFICATION",
        })
        .returning();
      operator = createdOp;
    }

    if (!operator) {
      throw new AppError(500, "OPERATOR_NOT_FOUND", "Unable to resolve operator profile");
    }

    const [existing] = await db
      .select()
      .from(evOwnerVerifications)
      .where(eq(evOwnerVerifications.operatorId, operator.id))
      .limit(1);

    let saved;
    if (existing) {
      const [updated] = await db
        .update(evOwnerVerifications)
        .set({
          ownerName: body.ownerName,
          businessType: body.businessType,
          panNumber: body.panNumber,
          gstinNumber: body.gstinNumber || null,
          businessDocName: body.businessDocName,
          businessDocRef: body.businessDocRef,
          siteAddress: body.siteAddress,
          siteCity: body.siteCity,
          ownershipType: body.ownershipType,
          propertyDocName: body.propertyDocName,
          propertyDocRef: body.propertyDocRef,
          nocDocName: body.nocDocName,
          nocDocRef: body.nocDocRef,
          electricityBoard: body.electricityBoard,
          electricityConsumerNo: body.electricityConsumerNo,
          sanctionedLoadKw: body.sanctionedLoadKw,
          chargerManufacturer: body.chargerManufacturer,
          chargerModel: body.chargerModel,
          chargerSerialNumber: body.chargerSerialNumber,
          connectorType: body.connectorType,
          complianceStandard: body.complianceStandard,
          chargerDocName: body.chargerDocName,
          chargerDocRef: body.chargerDocRef,
          verificationStatus: "PENDING",
          updatedAt: new Date(),
        })
        .where(eq(evOwnerVerifications.id, existing.id))
        .returning();
      saved = updated;
    } else {
      const [inserted] = await db
        .insert(evOwnerVerifications)
        .values({
          operatorId: operator.id,
          userId: user.id,
          ownerName: body.ownerName,
          businessType: body.businessType,
          panNumber: body.panNumber,
          gstinNumber: body.gstinNumber || null,
          businessDocName: body.businessDocName,
          businessDocRef: body.businessDocRef,
          siteAddress: body.siteAddress,
          siteCity: body.siteCity,
          ownershipType: body.ownershipType,
          propertyDocName: body.propertyDocName,
          propertyDocRef: body.propertyDocRef,
          nocDocName: body.nocDocName,
          nocDocRef: body.nocDocRef,
          electricityBoard: body.electricityBoard,
          electricityConsumerNo: body.electricityConsumerNo,
          sanctionedLoadKw: body.sanctionedLoadKw,
          chargerManufacturer: body.chargerManufacturer,
          chargerModel: body.chargerModel,
          chargerSerialNumber: body.chargerSerialNumber,
          connectorType: body.connectorType,
          complianceStandard: body.complianceStandard,
          chargerDocName: body.chargerDocName,
          chargerDocRef: body.chargerDocRef,
          verificationStatus: "PENDING",
        })
        .returning();
      saved = inserted;
    }

    await writeAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: "EV_OWNER_VERIFICATION_SUBMITTED",
      entityType: "EV_OWNER_VERIFICATION",
      entityId: saved?.id ?? operator.id,
      afterState: {
        panNumber: body.panNumber,
        electricityConsumerNo: body.electricityConsumerNo,
        chargerSerialNumber: body.chargerSerialNumber,
      },
    });

    return ok({ operator, verification: saved });
  } catch (err) {
    return handleApiError(err);
  }
}
