import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { MobilePlanFormDialog } from "../components/planting-plans/MobilePlanFormDialog";
import type { MobileCreateFormState } from "../pages/plantingPlansUtils";
import type { Crop } from "../api/types";
import {
  getPlanPropagationInfo,
  getPlanSowingSchedule,
  getPlantingDateFromSowingDate as resolvePlantingDateFromSowingDate,
} from "../pages/planSowingDate";
import { parseGermanDateText, toIsoDateString, formatDateAsGerman } from "../components/data-grid/dateEditCellUtils";

const anzuchtCrop: Crop = { id: 1, name: "Tomate", cultivation_types: ["pre_cultivation"], propagation_duration_days: 20 };
const anzuchtCropWithoutDuration: Crop = { id: 2, name: "Mystery", cultivation_types: ["pre_cultivation"] };
const directCrop: Crop = { id: 3, name: "Karotte", cultivation_types: ["direct_sowing"] };
const crops: Crop[] = [anzuchtCrop, anzuchtCropWithoutDuration, directCrop];

const findCrop = (form: MobileCreateFormState): Crop | undefined =>
  crops.find((item) => item.id === Number(form.crop));

const isSowingDateDisabled = (form: MobileCreateFormState): boolean => {
  const info = getPlanPropagationInfo(form, findCrop(form));
  return info.isPreCultivation && info.propagationDurationDays === null;
};

const getSowingDateFromPlantingDate = (form: MobileCreateFormState): string => {
  const plantingDateIso = toIsoDateString(parseGermanDateText(form.planting_date));
  if (!plantingDateIso) {
    return "";
  }
  const schedule = getPlanSowingSchedule({ ...form, planting_date: plantingDateIso }, findCrop(form));
  return formatDateAsGerman(schedule?.sowingDate ?? null);
};

const getPlantingDateFromSowingDate = (form: MobileCreateFormState): string => {
  const sowingDateIso = toIsoDateString(parseGermanDateText(form.sowing_date));
  if (!sowingDateIso) {
    return form.planting_date;
  }
  return formatDateAsGerman(resolvePlantingDateFromSowingDate(sowingDateIso, form, findCrop(form)));
};

const initialForm: MobileCreateFormState = {
  crop: "1",
  bed: "101",
  cultivation_type: "pre_cultivation",
  sowing_date: "12.07.2026",
  planting_date: "1.8.2026",
  area_m2: "",
  plants_count: "",
  notes: "",
};

function renderDialog(form: MobileCreateFormState = initialForm) {
  function Wrapper() {
    const [currentForm, setForm] = useState(form);
    return (
      <MobilePlanFormDialog
        open
        isEdit={false}
        form={currentForm}
        setForm={setForm}
        error=""
        cropOptions={[
          { value: "1", label: "Tomate (Moneymaker)" },
          { value: "2", label: "Mystery" },
          { value: "3", label: "Karotte" },
        ]}
        bedOptions={[{ value: "101", label: "Parzelle | Beet" }]}
        cultivationTypeOptions={[
          { value: "pre_cultivation", label: "Vorkultur" },
          { value: "direct_sowing", label: "Direktsaat" },
        ]}
        numberLocale="de-DE"
        getPlantsPerSqm={() => null}
        isSowingDateDisabled={isSowingDateDisabled}
        getSowingDateFromPlantingDate={getSowingDateFromPlantingDate}
        getPlantingDateFromSowingDate={getPlantingDateFromSowingDate}
        onLinkedFieldEdited={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
  }

  return render(<Wrapper />);
}

describe("MobilePlanFormDialog", () => {
  it("opens a native picker for planting date and writes selected dates as German text", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole("textbox", { name: "Pflanztermin" })).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByRole("textbox", { name: "Fläche (m²)" })).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("textbox", { name: "Pflanzen (≈)" })).toHaveAttribute("inputmode", "numeric");

    const pickerInputs = document.querySelectorAll('input[type="date"]');
    const pickerInput = pickerInputs[pickerInputs.length - 1] as HTMLInputElement;
    const showPicker = vi.fn();
    pickerInput.showPicker = showPicker;

    await user.click(screen.getAllByRole("button", { name: "Kalender öffnen" }).slice(-1)[0]);
    expect(showPicker).toHaveBeenCalledTimes(1);

    fireEvent.change(pickerInput, { target: { value: "2026-08-05" } });
    expect(screen.getByRole("textbox", { name: "Pflanztermin" })).toHaveValue("05.08.2026");
  });

  it("recomputes the planting date from an edited sowing date for Anzucht", () => {
    renderDialog();

    const sowingField = screen.getByRole("textbox", { name: "Aussaattermin" });
    fireEvent.change(sowingField, { target: { value: "01.07.2026" } });

    expect(sowingField).toHaveValue("01.07.2026");
    // 20 days of propagation duration later.
    expect(screen.getByRole("textbox", { name: "Pflanztermin" })).toHaveValue("21.07.2026");
  });

  it("recomputes the sowing date from an edited planting date for Anzucht", () => {
    renderDialog();

    const plantingField = screen.getByRole("textbox", { name: "Pflanztermin" });
    fireEvent.change(plantingField, { target: { value: "21.08.2026" } });

    expect(plantingField).toHaveValue("21.08.2026");
    expect(screen.getByRole("textbox", { name: "Aussaattermin" })).toHaveValue("01.08.2026");
  });

  it("keeps sowing and planting date identical for direct sowing", () => {
    renderDialog({ ...initialForm, crop: "3", cultivation_type: "direct_sowing" });

    const plantingField = screen.getByRole("textbox", { name: "Pflanztermin" });
    fireEvent.change(plantingField, { target: { value: "10.09.2026" } });

    expect(screen.getByRole("textbox", { name: "Aussaattermin" })).toHaveValue("10.09.2026");
  });

  it("disables the sowing date field and shows a helper text when the crop has no propagation duration", () => {
    renderDialog({ ...initialForm, crop: "2", cultivation_type: "pre_cultivation" });

    const sowingField = screen.getByRole("textbox", { name: "Aussaattermin" });
    expect(sowingField).toBeDisabled();
    expect(screen.getByText("Nicht berechenbar, da für diese Kultur keine Anzuchtdauer hinterlegt ist.")).toBeInTheDocument();
  });
});
