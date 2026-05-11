# Product Requirements Document (PRD)
## Project: Streamsync

---

## PROJECT CONTEXT
**Project Name:** Streamsync  
**Sponsor:** Streamsync Research Consortium (multi-center)  
**Principal Investigator:** Daniel Wong, MD  
**Platform:** iOS-first (React Native / Expo), cross-platform where feasible  

**Tech Stack:**
- React Native + Expo  
- Spezi Vibe framework  
- Apple HealthKit + Apple Watch  
- Apple ResearchKit  
- Throne Uroflow API  
- Cloud backend (PI-managed; e.g., GCP / Medplum / Firebase)

---

## PROBLEM STATEMENT
Patients with benign prostatic hyperplasia (BPH) undergoing bladder outlet surgery are currently evaluated using a combination of clinic-based tests and subjective symptom questionnaires (e.g., IPSS). These approaches fail to capture real-world, longitudinal functional outcomes such as daily voiding behavior, physical activity, and sleep quality.

As a result, clinicians and researchers lack objective, continuous measures to determine whether bladder outlet surgery leads to meaningful improvements in patients’ daily function and quality of life.

HomeFlow addresses this gap by enabling passive, longitudinal measurement of voiding patterns, activity, and sleep in the home environment, before and after surgery, to better characterize surgical benefit and identify which patients derive the greatest functional improvement.

---

## TARGET USERS
**Primary Users:**  
- Patients with BPH undergoing or being evaluated for bladder outlet surgery  

**Secondary Users:**  
- Clinical researchers  
- Principal investigators (PIs)  
- Care teams analyzing de-identified longitudinal data  

---

## PRODUCT GOALS
1. Enable consented enrollment of BPH patients into a digital research study using mobile devices.  
2. Passively collect real-world voiding, activity, and sleep data longitudinally in the home environment.  
3. Integrate Throne uroflow data with wearable-derived activity and sleep metrics.  
4. Collect and track IPSS scores over time to correlate subjective symptoms with objective data.  
5. Upload structured, de-identified data to a secure, PI-managed backend for research analysis.

---

## SUCCESS METRICS
Success for this project will be evaluated by:
- Completion rate of patient enrollment and consent  
- Longitudinal data completeness across voiding, activity, sleep, and surveys  
- Adherence to daily passive data collection over time  
- Ability to correlate changes in objective metrics (e.g., uroflow, activity, sleep) with changes in IPSS scores pre- and post-surgery  

---

## ENROLLMENT & CONSENT FLOW
1. **Eligibility Screening:**  
   - Conducted via Apple ResearchKit to confirm study eligibility.  

2. **Informed Consent:**  
   - Standard research consent flow presented and signed within the app.  

3. **Permissions:**  
   - Apple HealthKit access (including clinical records where available).  
   - Apple Watch data access.  
   - Throne uroflow device access.  

4. **Initial Data Intake:**  
   - Demographics and medical history pulled from HealthKit when available.  
   - Chatbot-assisted completion of missing medical history fields.  
   - Completion of baseline IPSS survey via chatbot interface.

---

## DATA SOURCES & DATA TYPES

### Throne Uroflow Data
- Void timestamp  
- Voided volume  
- Maximum flow rate (Qmax)  
- Average flow rate (Qavg)  
- Flow curve shape  
- Voiding frequency  
- Nocturia events  
- Patient annotations (e.g., straining, urgency)

### Apple HealthKit / Apple Watch
- Step count  
- Active minutes  
- Sedentary time  
- Sleep duration and stages  
- Heart rate and related vitals (when available)

### Surveys
- International Prostate Symptom Score (IPSS), collected longitudinally

---

## DATA SYNC & STORAGE
- **Sync Frequency:** Approximately once per day  
- **Storage:** Secure, PI-managed research backend  
- **Privacy:**  
  - Data is de-identified prior to research use  
  - No unnecessary PHI is stored  
- **Purpose:** Research analysis only (not clinical decision-making)

---

## USER STORIES
- *As a patient, I want to enroll in a study from my phone so that I can participate without frequent clinic visits.*  
- *As a patient, I want my voiding data collected automatically so that I don’t need to manually log symptoms.*  
- *As a patient, I want to complete IPSS surveys easily so that my symptoms are tracked over time.*  
- *As a researcher, I want access to longitudinal, de-identified data so that I can analyze functional outcomes of surgery.*

---

## USE CASES
- First-time onboarding and consent  
- Baseline data collection before surgery  
- Daily passive data collection after surgery  
- Periodic IPSS survey prompts  
- Handling missing data or failed syncs  
- Researcher review of data completeness and trends  

---

## FUNCTIONAL REQUIREMENTS
- The app must support ResearchKit-based consent and enrollment.  
- The app must collect Throne and HealthKit data after user consent.  
- The app must store data locally and upload it to a secure backend.  
- The app must prompt users to complete IPSS surveys at defined intervals.  
- The app must provide a research-facing view of data completeness and participation (read-only).

---

## NON-FUNCTIONAL REQUIREMENTS
- Privacy-first defaults appropriate for research use.  
- No real-time clinical alerts or treatment recommendations.  
- iOS HealthKit limitations acknowledged (e.g., delayed syncs).  
- Demo-safe and prototype-grade implementations acceptable for the pilot phase.

---

## IN SCOPE
- Patient enrollment and consent  
- Passive data collection (uroflow, activity, sleep)  
- Survey collection  
- Secure data upload for research  

---

## OUT OF SCOPE
- Real-time clinical decision support  
- EMR write-back or provider ordering  
- Production-grade regulatory compliance  
- Large-scale deployment beyond study context  

---

## ASSUMPTIONS & CONSTRAINTS
- This is a research pilot study run by the Streamsync Research Consortium.  
- Backend infrastructure may be simulated or partially stubbed.  
- Data collected is not used for clinical care.  
- AI-generated code must strictly adhere to this PRD.  
- During in-class demos, Throne uroflow data may be simulated if physical hardware is unavailable, while maintaining realistic data schemas and flows.

---

## DELIVERABLE EXPECTATION
This PRD should be sufficiently detailed that an AI agent can:
- Generate implementation tasks  
- Scaffold components and data pipelines  
- Implement features with minimal clarification  

---
