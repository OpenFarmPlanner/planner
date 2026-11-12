"""Feature examples shared by personal, guest and command-line demo projects."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from farm.models import (
    Crop,
    CropCompanion,
    CropSupplierData,
    CropTaskTemplate,
    Field,
    Project,
    Season,
    Supplier,
    Task,
)
from farm.services.crop_companions import CompanionTarget, relation_kwargs
from farm.services.tasks import generate_tasks_for_plans
from farm.services.timing_windows import DECADE_BY_NUMBER

FEATURE_TEXT = {
    "de": {
        "tags": ["Fruchtgemüse", "Lagergemüse", "Wintergemüse", "Gründüngung"],
        "pretreatment": "Aussaat gleichmäßig feucht halten.",
        "companion_note": "Beispiel für die betriebseigene Mischkulturplanung.",
        "flower_strip": "Blühstreifen",
        "templates": [
            "Tomaten anbinden",
            "Mulch und Bodenfeuchte prüfen",
            "Vlies vor der Aussaat auslegen",
        ],
        "template_description": (
            "Jeden Termin einzeln erledigen; beim Verschieben des Anbauplans "
            "bleiben erledigte Aufgaben erhalten."
        ),
        "tasks": [
            "Zaun am Pachtacker prüfen",
            "Beete jäten",
            "Erntekisten reinigen",
            "Bewässerung kontrollieren",
            "Kompostlieferung abstimmen",
            "Zusätzliche Saatgutbestellung",
            "Abdeckvlies kontrollieren",
        ],
        "task_description": "Beispielaufgabe für die gemeinsame Arbeitsplanung im Demo-Projekt.",
    },
    "en": {
        "tags": ["Fruiting vegetables", "Storage crops", "Winter vegetables", "Green manure"],
        "pretreatment": "Keep the seedbed evenly moist.",
        "companion_note": "Example of farm-specific companion planting knowledge.",
        "flower_strip": "Flower strip",
        "templates": [
            "Tie up tomatoes",
            "Check mulch and soil moisture",
            "Lay fleece before sowing",
        ],
        "template_description": (
            "Complete each occurrence separately; completed tasks survive "
            "rescheduling of the planting plan."
        ),
        "tasks": [
            "Check the fence on the leased field",
            "Weed the beds",
            "Clean harvest crates",
            "Check irrigation",
            "Arrange the compost delivery",
            "Additional seed order",
            "Check the covering fleece",
        ],
        "task_description": "Sample task for shared work planning in the demo project.",
    },
    "fr": {
        "tags": ["Légumes-fruits", "Légumes de conservation", "Légumes d'hiver", "Engrais vert"],
        "pretreatment": "Maintenir le lit de semences uniformément humide.",
        "companion_note": "Exemple d'association de cultures propre à la ferme.",
        "flower_strip": "Bande fleurie",
        "templates": [
            "Attacher les tomates",
            "Vérifier le paillage et l'humidité du sol",
            "Poser le voile avant le semis",
        ],
        "template_description": (
            "Terminer chaque occurrence séparément ; les tâches terminées sont conservées "
            "lors du déplacement du plan de culture."
        ),
        "tasks": [
            "Vérifier la clôture de la parcelle louée",
            "Désherber les planches",
            "Nettoyer les caisses de récolte",
            "Contrôler l'irrigation",
            "Organiser la livraison de compost",
            "Commande supplémentaire de semences",
            "Vérifier le voile de protection",
        ],
        "task_description": (
            "Exemple de tâche pour le travail collectif dans le projet de démonstration."
        ),
    },
    "es": {
        "tags": [
            "Hortalizas de fruto", "Hortalizas de conservación",
            "Hortalizas de invierno", "Abono verde",
        ],
        "pretreatment": "Mantener el lecho de siembra uniformemente húmedo.",
        "companion_note": "Ejemplo de asociación de cultivos propia de la finca.",
        "flower_strip": "Franja floral",
        "templates": [
            "Entutorar los tomates",
            "Revisar el acolchado y la humedad del suelo",
            "Colocar la manta antes de la siembra",
        ],
        "template_description": (
            "Completar cada repetición por separado; las tareas completadas se conservan "
            "al cambiar las fechas del plan de cultivo."
        ),
        "tasks": [
            "Revisar la valla de la parcela arrendada",
            "Desherbar los bancales",
            "Limpiar las cajas de cosecha",
            "Revisar el riego",
            "Organizar la entrega de compost",
            "Pedido adicional de semillas",
            "Revisar la manta de protección",
        ],
        "task_description": (
            "Tarea de ejemplo para el trabajo compartido en el proyecto de demostración."
        ),
    },
}

BOTANICAL_NAMES = {
    "tomate-art": "Solanum lycopersicum",
    "karotte-art": "Daucus carota",
    "salat-art": "Lactuca sativa",
    "gurke-art": "Cucumis sativus",
    "mangold-art": "Beta vulgaris",
    "rote-bete-art": "Beta vulgaris",
    "kohlrabi-art": "Brassica oleracea",
    "zucchini-art": "Cucurbita pepo",
    "kartoffel": "Solanum tuberosum",
    "erbse": "Pisum sativum",
    "buschbohne": "Phaseolus vulgaris",
    "knoblauch": "Allium sativum",
    "lauch": "Allium porrum",
    "brokkoli": "Brassica oleracea",
    "senf": "Sinapis alba",
    "zuckermais": "Zea mays",
    "phacelia": "Phacelia tanacetifolia",
    "erdbeere": "Fragaria × ananassa",
}


def populate_demo_crop_features(
    project: Project,
    crops: dict[str, Crop],
    suppliers: dict[str, Supplier],
    *,
    language_code: str,
) -> None:
    text = FEATURE_TEXT[language_code]
    for key, botanical_name in BOTANICAL_NAMES.items():
        crop = crops[key]
        crop.botanical_name = botanical_name
        crop.save()
    for index, keys in enumerate(
        [
            ["tomate-art", "gurke-art", "zucchini-art"],
            ["karotte-art", "rote-bete-art", "kartoffel"],
            ["mangold-art", "lauch"],
            ["senf", "phacelia"],
        ]
    ):
        for key in keys:
            crops[key].tags = [text["tags"][index]]
            crops[key].save()
    _populate_germination_and_windows(crops, text)
    _populate_companions(project, crops, text, language_code=language_code)
    _populate_supplier_statuses(project, crops, suppliers)
    _populate_task_templates(project, crops, text)


def _populate_germination_and_windows(crops: dict[str, Crop], text: dict[str, Any]) -> None:
    for key, minimum, maximum, threshold, days_min, days_max, kind in [
        ("tomate-art", 20, 26, 10, 6, 14, "dark"),
        ("salat-art", 12, 18, 3, 4, 10, "light"),
        ("karotte-art", 15, 20, 3, 10, 21, "dark"),
        ("gurke-art", 22, 28, 12, 4, 10, "dark"),
    ]:
        crop = crops[key]
        crop.germination_temperature_optimal_min_c = minimum
        crop.germination_temperature_optimal_max_c = maximum
        crop.germination_temperature_min_c = threshold
        crop.germination_days_min = days_min
        crop.germination_days_max = days_max
        crop.germination_types = [kind]
        crop.germination_pretreatment = text["pretreatment"]
        crop.save()
    windows: dict[str, list[dict[str, Any]]] = {
        "tomate-art": [
            _decade_window("pre_cultivation", 2, 3, 4, 2),
            _decade_window("planting", 4, 3, 6, 1),
        ],
        "salat-art": [
            _decade_window("direct_sowing", 3, 1, 5, 3),
            _decade_window("direct_sowing", 8, 1, 9, 2),
            _decade_window("pre_cultivation", 2, 1, 8, 3),
            {"kind": "planting", "unit": "iso_week", "start_week": 10, "end_week": 40},
        ],
        "karotte-art": [_decade_window("direct_sowing", 3, 1, 7, 3)],
        "knoblauch": [_decade_window("direct_sowing", 10, 1, 2, 3)],
    }
    for key, rows in windows.items():
        crops[key].pending_timing_windows = rows
        crops[key].save()


def _decade_window(
    kind: str, start: int, start_part: int, end: int, end_part: int
) -> dict[str, Any]:
    return {
        "kind": kind,
        "unit": "decade",
        "start_month": start,
        "start_decade": DECADE_BY_NUMBER[start_part],
        "end_month": end,
        "end_decade": DECADE_BY_NUMBER[end_part],
    }


def _populate_companions(
    project: Project, crops: dict[str, Crop], text: dict[str, Any], *, language_code: str,
) -> None:
    for key, other, kind, reason in [
        ("tomate-art", "kartoffel", "bad", "shared_pests_diseases"),
        ("karotte-art", "lauch", "good", "pest_control"),
    ]:
        CropCompanion.objects.create(
            project=project,
            kind=kind,
            reason=reason,
            note=text["companion_note"],
            notes={language_code: text["companion_note"]},
            **relation_kwargs(crops[key], CompanionTarget(type="crop", crop=crops[other])),
        )
    CropCompanion.objects.create(
        project=project,
        crop=crops["brokkoli"],
        companion_family_id="Fabaceae",
        kind="good",
        reason="soil",
        note=text["companion_note"],
        notes={language_code: text["companion_note"]},
    )
    CropCompanion.objects.create(
        project=project,
        crop=crops["tomate-art"],
        companion_text=text["flower_strip"],
        kind="good",
        reason="other",
        note=text["companion_note"],
        notes={language_code: text["companion_note"]},
    )


def _populate_supplier_statuses(
    project: Project,
    crops: dict[str, Crop],
    suppliers: dict[str, Supplier],
) -> None:
    CropSupplierData.objects.filter(project=project).update(
        seed_status="organic",
        seed_exemption_status="not_required",
    )
    CropSupplierData.objects.filter(crop=crops["salat-maikoenig"]).update(
        seed_status="unknown",
        seed_exemption_status="unknown",
    )
    CropSupplierData.objects.filter(crop=crops["tomate-san-marzano"]).update(
        seed_status="conventional",
        seed_exemption_status="not_approved",
    )
    for crop_key, supplier_key, seed_status, exemption in [
        ("tomate", "bingenheimer", "conventional", "approved"),
        ("karotte", "sativa", "in_conversion", "not_required"),
    ]:
        crop = crops[crop_key]
        primary = crop.supplier_data.get(supplier_id=crop.selected_seed_demand_supplier_id)
        primary.price = Decimal("2.90")
        primary.save()
        supplier = suppliers[supplier_key]
        CropSupplierData.objects.create(
            project=project,
            crop=crop,
            supplier=supplier,
            supplier_name=supplier.name,
            packaging_sizes=primary.packaging_sizes,
            price=Decimal("3.20"),
            seed_status=seed_status,
            seed_exemption_status=exemption,
            thousand_kernel_weight_g=primary.thousand_kernel_weight_g,
            germination_rate=primary.germination_rate,
        )


def _populate_task_templates(
    project: Project, crops: dict[str, Crop], text: dict[str, Any]
) -> None:
    for index, key, event, offset, interval, until, count in [
        (0, "tomate", "planting", 7, 7, "count", 3),
        (1, "erdbeere", "planting", 14, 30, "harvest_end", None),
        (2, "karotte", "sowing", -2, None, "", None),
    ]:
        CropTaskTemplate.objects.create(
            project=project,
            crop=crops[key],
            title=text["templates"][index],
            description=text["template_description"],
            reference_event=event,
            day_offset=offset,
            repeat_interval_days=interval,
            repeat_until=until,
            repeat_count=count,
        )


def populate_demo_tasks(
    project: Project,
    *,
    owner: Any | None,
    today: date,
    fields: dict[str, Field],
    crops: dict[str, Crop],
    language_code: str,
) -> None:
    generate_tasks_for_plans(project.planting_plans.select_related("crop", "season").order_by("pk"))
    Task.objects.filter(project=project, due_date__lt=today).update(status="completed")
    season = Season.objects.get(project=project, start_date__year=today.year)
    text = FEATURE_TEXT[language_code]
    assignee = owner if owner and getattr(owner, "pk", None) else None
    for index, status, offset, field_key, crop_key in [
        (0, "pending", 6, "schlag-nord", None),
        (1, "in_progress", 0, "wurzel", "karotte"),
        (2, "completed", -1, None, None),
        (3, "pending", 2, "tunnel", "tomate"),
        (4, "pending", None, None, None),
        (5, "cancelled", -3, None, None),
        (6, "pending", -2, "fruehbeete", "salat"),
    ]:
        Task.objects.create(
            project=project,
            season=season,
            title=text["tasks"][index],
            description=text["task_description"],
            status=status,
            due_date=today + timedelta(days=offset) if offset is not None else None,
            field=fields[field_key] if field_key is not None else None,
            crop=crops[crop_key] if crop_key is not None else None,
            assigned_to=assignee if offset is not None else None,
        )
    adjusted = (
        Task.objects.filter(
            project=project,
            season=season,
            origin="automatic",
            status="completed",
        )
        .order_by("due_date", "pk")
        .first()
    )
    if adjusted is not None and adjusted.calculated_due_date is not None:
        adjusted.due_date = adjusted.calculated_due_date + timedelta(days=2)
        adjusted.due_date_overridden = True
        adjusted.save(update_fields=["due_date", "due_date_overridden"])
