"""Offline SDK declaration validation. Keep existing Haze identity/upload checks."""
import json
from pathlib import Path, PurePosixPath
from jsonschema import Draft202012Validator

CONTRACT = json.loads(Path(__file__).with_name("automation-sdk-contract.json").read_text(encoding="utf-8"))

def validate_declaration(definition, value):
    schema = {"$defs": CONTRACT["$defs"], "$ref": "#/$defs/" + definition}
    return ["/" + "/".join(map(str, error.absolute_path)) + ": " + error.message for error in Draft202012Validator(schema).iter_errors(value)]

def validate_sdk_files(files):
    """files is a validated ZIP mapping {relative_path: bytes}; never execute code."""
    errors = []
    if len(files) > CONTRACT["limits"]["packageFiles"] or sum(len(value) for value in files.values()) > CONTRACT["limits"]["packageBytes"]:
        return ["Package exceeds SDK file count/size limits"]
    for name in files:
        path = PurePosixPath(name)
        if path.is_absolute() or "\\" in name or any(part in ("", ".", "..") for part in name.split("/")):
            errors.append("Unsafe package path: " + name)
    def read(name):
        if name not in files:
            raise ValueError("Missing file: " + name)
        if name.endswith(".json") and len(files[name]) > 1024 * 1024:
            raise ValueError("JSON file exceeds 1 MiB: " + name)
        return json.loads(files[name].decode("utf-8"))
    try:
        plugin = read("plugin.json")
        automation = plugin["extensions"]["com.eureka"]["automation"]
        errors.extend(validate_declaration("automation", automation))
        package = read("package.json")
        if package.get("name") != plugin.get("name") or package.get("version") != plugin.get("version") or package.get("type") != "module" or any(key in package for key in ("dependencies", "devDependencies", "scripts")):
            errors.append("Package identity, ESM type or dependencies/scripts are invalid")
        if set(automation["files"]) != set(files):
            errors.append("Declared files differ from ZIP contents")
        definitions = [("ui", "ui.json"), ("workflow", "workflow.json")]
        for action in automation.get("actions", []):
            definitions += [("ui", action["ui"]), ("workflow", action["workflow"])]
            if not set(action.get("capabilities", automation["capabilities"])).issubset(automation["capabilities"]):
                errors.append("Action capabilities exceed application capabilities")
        for definition, name in definitions:
            errors.extend(name + " " + error for error in validate_declaration(definition, read(name)))
        for entry in [automation["entry"], *[action["entry"] for action in automation.get("actions", [])]]:
            if entry not in files or not entry.startswith("scripts/") or not entry.endswith((".js", ".mjs")):
                errors.append("Missing or invalid entry: " + entry)
        for required in ("README.md",):
            if required not in files:
                errors.append("Missing file: " + required)
    except (KeyError, TypeError, ValueError, UnicodeError) as error:
        errors.append("Invalid SDK package: " + str(error))
    return errors

if __name__ == "__main__":
    import sys
    payload = json.load(sys.stdin)
    errors = validate_declaration(payload["definition"], payload["value"])
    json.dump({"sdkVersion": CONTRACT["sdkVersion"], "valid": not errors, "errors": errors}, sys.stdout)
